/**
 * `prof brainstorm "<vague idea>"` — divergent thinking.
 *
 * The "I don't know what I want to research" command. Takes a vague seed,
 * expands it into 5-10 concrete framings + adjacent questions, with
 * grounding from your library if available.
 */
import { complete, MODELS, totalCostUsd } from "../lib/llm.js";
import { retrieve } from "../algorithms/rag.js";
import { countPapers } from "../db/client.js";
import { c } from "../tui/colors.js";

export async function cmdBrainstorm(seed: string, opts: { verbose?: boolean } = {}): Promise<void> {
  const log = (m: string) => opts.verbose && console.log(c.dim(`  · ${m}`));
  const costBefore = totalCostUsd();

  console.log();
  console.log(c.primary("brainstorm: ") + c.italic(seed));
  console.log();

  // Optional library grounding
  let libraryContext = "";
  if (countPapers() > 0) {
    try {
      log("checking library for related papers");
      const hits = await retrieve(seed, { k: 5, noteCharCap: 600 });
      if (hits.hits.length > 0) {
        libraryContext =
          "\n\nFrom your library (related papers, prefer to ground in these):\n" +
          hits.hits
            .map(
              (h, i) =>
                `${i + 1}. ${h.paper.title} (${h.paper.year ?? "?"})\n   abstract: ${(h.paper.abstract ?? "").slice(0, 300).replace(/\n/g, " ")}...`,
            )
            .join("\n\n");
      }
    } catch (err) {
      log(`retrieval failed: ${(err as Error).message}`);
    }
  }

  log("generating framings");
  const { text: framings, cost } = await complete({
    model: MODELS.smart,
    system: `You are a research brainstorming partner. The user gives you a vague idea, possibly half-formed. Your job: expand it into concrete research framings and adjacent questions a PhD could actually pursue. Be specific. Mention methods, datasets, evaluation when you can. Avoid filler. ${libraryContext ? "Ground framings in the user's library where the topic overlaps." : ""}`,
    prompt: `Seed idea: ${seed}

Produce three sections in markdown:

## Three concrete framings

Three different ways to make this idea into a tractable research question. Each:
- One clear question
- Why it matters (1 sentence)
- A path: method + data + evaluation (1 sentence)

## Five adjacent angles

Related but different questions that share intellectual roots. Use as escape valves if the main framings hit dead ends.

## What to read first

Three specific papers, concepts, or terms to look up next. If you can recommend specific authors or labs, do.${libraryContext}`,
    maxTokens: 2000,
    temperature: 0.7,
  });

  console.log(framings);
  console.log();
  console.log(c.dim(`cost: $${(totalCostUsd() - costBefore).toFixed(4)}`));
  console.log(c.dim("next: ") + c.bold(`prof map "<framing-keyword>"`) + c.dim("  or  ") + c.bold(`prof gap "<X> and <Y>"`));
  console.log();
}
