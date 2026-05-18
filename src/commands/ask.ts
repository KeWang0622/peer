/**
 * `prof ask "<question>"` — query your library.
 *
 * Flow:
 *   1. Embed the question.
 *   2. Retrieve top-K papers by cosine similarity (title + abstract embeddings).
 *   3. Stream a Claude Sonnet answer grounded ONLY in the retrieved context.
 *   4. Print a Sources block with citation tags.
 *
 * Embeddings are computed inline per invocation (no persistent cache yet).
 * If the library is empty we short-circuit with a helpful pointer.
 */
import { claude, MODELS, priceTokens, recordCost, totalCostUsd, CostEntry } from "../lib/llm.js";
import { ensureDirs } from "../config/paths.js";
import { countPapers } from "../db/client.js";
import { buildContextBlock, citationTag, retrieve, RetrievedPaper } from "../algorithms/rag.js";

export interface AskOptions {
  verbose?: boolean;
  k?: number;
}

export interface AskResult {
  answer: string;
  hits: RetrievedPaper[];
  cost: number;
}

const SYSTEM_PROMPT =
  "You are answering a researcher's question using ONLY the provided papers and notes. " +
  "Always cite via [arxiv:ID] format (or [doi:...] / [s2:...] when arxiv is unavailable). " +
  "If the library doesn't contain enough information, say so honestly. " +
  "Be concrete: prefer specific claims grounded in the supplied context over generic background.";

export async function cmdAsk(question: string, opts: AskOptions = {}): Promise<AskResult> {
  ensureDirs();

  const log = (msg: string) => {
    if (opts.verbose) console.log(`  · ${msg}`);
  };

  // Empty library short-circuit. Avoid spending on embeddings if there's nothing to retrieve.
  if (countPapers() === 0) {
    console.log("Your library is empty. Run `prof read <arxiv-id>` first or `prof map <topic>` to seed it.");
    return { answer: "", hits: [], cost: 0 };
  }

  console.log(`\nAsking: ${question}\n`);

  const retrieval = await retrieve(question, {
    k: opts.k,
    onProgress: (step, detail) => log(`${step}${detail ? `: ${detail}` : ""}`),
  });

  if (retrieval.hits.length === 0) {
    console.log("No relevant papers found in your library. Try `prof read <arxiv-id>` to add more.");
    return { answer: "", hits: [], cost: retrieval.embedCost.costUsd };
  }

  const contextBlock = buildContextBlock(retrieval.hits);
  const userPrompt = `Question: ${question}

The following papers were retrieved from the researcher's local library. Each is labeled with its citation tag in square brackets — use those exact tags when citing.

${contextBlock}

Answer the question using only the information above. If the retrieved context is insufficient, say so explicitly rather than guessing. Cite every non-trivial claim inline with [arxiv:ID] or the alternate tag shown.`;

  // Stream the answer. SDK >= 0.40 returns an async iterator over MessageStreamEvents.
  log(`streaming via ${MODELS.smart}`);
  const stream = claude().messages.stream({
    model: MODELS.smart,
    max_tokens: 2048,
    temperature: 0.3,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  let answer = "";
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      const chunk = event.delta.text;
      answer += chunk;
      process.stdout.write(chunk);
    }
  }
  // Ensure trailing newline after the streamed body.
  if (!answer.endsWith("\n")) process.stdout.write("\n");

  // Final message gives us authoritative usage stats.
  const finalMessage = await stream.finalMessage();
  const inputTokens = finalMessage.usage.input_tokens ?? 0;
  const outputTokens = finalMessage.usage.output_tokens ?? 0;
  const cacheReadTokens =
    (finalMessage.usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0;
  const cacheWriteTokens =
    (finalMessage.usage as { cache_creation_input_tokens?: number }).cache_creation_input_tokens ?? 0;

  const answerCostUsd = priceTokens(
    MODELS.smart,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
  );
  const answerCost: CostEntry = {
    model: MODELS.smart,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    costUsd: answerCostUsd,
  };
  recordCost(answerCost);

  // Sources section.
  console.log("\n## Sources\n");
  retrieval.hits.forEach((h, i) => {
    const p = h.paper;
    const tag = citationTag(p);
    const yearStr = p.year ? ` (${p.year})` : "";
    const score = h.score.toFixed(3);
    console.log(`${i + 1}. [${tag}] ${p.title}${yearStr}  ·  similarity ${score}`);
  });

  const turnCost = retrieval.embedCost.costUsd + answerCostUsd;
  console.log(
    `\nCost: $${turnCost.toFixed(4)} this turn  ·  total this session: $${totalCostUsd().toFixed(3)}`,
  );
  console.log(`Library: ${retrieval.libraryPaperCount} papers searched, top ${retrieval.hits.length} cited\n`);

  return { answer, hits: retrieval.hits, cost: turnCost };
}
