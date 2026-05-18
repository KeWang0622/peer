/**
 * `prof outline "<topic>"` — generate a paper outline + section sketches + suggested citations.
 *
 * The "I have a research idea and need to structure a paper" command.
 */
import { complete, MODELS, totalCostUsd } from "../lib/llm.js";
import * as s2 from "../api/semantic-scholar.js";
import { retrieve } from "../algorithms/rag.js";
import { countPapers } from "../db/client.js";
import { c } from "../tui/colors.js";

export async function cmdOutline(topic: string, opts: { verbose?: boolean } = {}): Promise<void> {
  const log = (m: string) => opts.verbose && console.log(c.dim(`  · ${m}`));
  const costBefore = totalCostUsd();

  console.log();
  console.log(c.primary("outline: ") + c.italic(topic));
  console.log();

  // Get related work hints
  let libraryContext = "";
  if (countPapers() > 0) {
    try {
      const hits = await retrieve(topic, { k: 6, noteCharCap: 0 });
      if (hits.hits.length > 0) {
        libraryContext =
          "\n\nFrom your library (cite when relevant):\n" +
          hits.hits.map((h, i) => `${i + 1}. ${h.paper.title} (${h.paper.year ?? "?"})`).join("\n");
      }
    } catch (err) {
      log(`library retrieve failed: ${(err as Error).message}`);
    }
  }

  // External recent literature
  let externalContext = "";
  try {
    log("fetching recent literature");
    const resp = await s2.searchPapers(topic, { limit: 8 });
    if (resp.data.length > 0) {
      externalContext =
        "\n\nRecent recent external literature:\n" +
        resp.data.slice(0, 8).map((p, i) => `${i + 1}. ${p.title} (${p.year ?? "?"}, ${p.citationCount ?? 0} cites)`).join("\n");
    }
  } catch (err) {
    log(`s2 fetch failed: ${(err as Error).message.slice(0, 60)}`);
  }

  log("generating outline");
  const { text: outline, cost } = await complete({
    model: MODELS.smart,
    system: `You generate paper outlines for ML/CS PhD researchers. Output is a structured markdown outline with: title proposal, abstract (3 sentences), 6-7 sections each with 2-4 bullet points of what to cover, and a 'Citations needed' list mapping sections to claims that need citations.`,
    prompt: `Topic / research idea: ${topic}
${libraryContext}${externalContext}

Generate a paper outline in this exact markdown structure:

# <suggested title (specific, methods-forward)>

## Abstract
<3 sentences: problem · approach · main finding>

## 1. Introduction
- <bullet>
- <bullet>

## 2. Related Work
- <bullet>
- <bullet>

## 3. Method
- <bullet>
- <bullet>

## 4. Experiments
- <bullet>
- <bullet>

## 5. Results
- <bullet>
- <bullet>

## 6. Discussion / Limitations
- <bullet>
- <bullet>

## 7. Conclusion
- <bullet>

## Citations needed
- Section 1 (intro motivation): need citations for <claim 1>, <claim 2>
- Section 2 (related work): need 3-5 papers each on <theme A>, <theme B>, <theme C>
- ...

Be specific. Mention concrete methods, datasets, evaluation metrics. Don't pad.`,
    maxTokens: 3000,
    temperature: 0.5,
  });

  console.log(outline);
  console.log();
  console.log(c.dim(`cost: $${(totalCostUsd() - costBefore).toFixed(4)}`));
  console.log(c.dim("next: ") + c.bold(`prof cite "<claim>"`) + c.dim("  or  ") + c.bold(`prof relwork "<topic>"`));
  console.log();
}
