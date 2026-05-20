/**
 * `peer compare <id1> <id2>` — side-by-side comparison of two papers.
 *
 * Lets PhDs synthesize what's similar and what's different between two papers.
 */
import { complete, MODELS, totalCostUsd } from "../lib/llm.js";
import * as s2 from "../api/semantic-scholar.js";
import * as ax from "../api/arxiv.js";
import { db, type PaperRow, paperCanonicalId } from "../db/client.js";
import { c } from "../tui/colors.js";

interface PaperInfo {
  title: string;
  authors: string[];
  year: number | null;
  abstract: string;
  source: "library" | "s2" | "arxiv";
}

async function resolveOne(input: string): Promise<PaperInfo | null> {
  const trimmed = input.trim();

  // Library hit?
  const candidates = [
    `arxiv:${trimmed.replace(/v\d+$/, "")}`,
    `doi:${trimmed.toLowerCase()}`,
    paperCanonicalId({ arxiv_id: trimmed }),
  ];
  for (const id of candidates) {
    try {
      const row = db().prepare<[string], PaperRow>("SELECT * FROM papers WHERE id = ?").get(id);
      if (row && row.abstract) {
        return {
          title: row.title,
          authors: [],
          year: row.year,
          abstract: row.abstract,
          source: "library",
        };
      }
    } catch {
      /* continue */
    }
  }

  // S2 lookup
  try {
    const lookup = ax.isArxivId(trimmed) ? `arXiv:${trimmed.replace(/v\d+$/, "")}` : trimmed;
    const p = await s2.getPaper(lookup);
    return {
      title: p.title,
      authors: (p.authors ?? []).map((a) => a.name),
      year: p.year ?? null,
      abstract: p.abstract ?? "(no abstract)",
      source: "s2",
    };
  } catch {
    /* try arxiv */
  }

  // arxiv direct
  if (ax.isArxivId(trimmed)) {
    try {
      const e = await ax.getArxivById(trimmed);
      if (e) {
        return {
          title: e.title,
          authors: e.authors,
          year: e.published ? parseInt(e.published.slice(0, 4)) : null,
          abstract: e.summary,
          source: "arxiv",
        };
      }
    } catch {
      /* fall through */
    }
  }
  return null;
}

export async function cmdCompare(idA: string, idB: string, opts: { verbose?: boolean } = {}): Promise<void> {
  const log = (m: string) => opts.verbose && console.log(c.dim(`  · ${m}`));
  const costBefore = totalCostUsd();

  log(`resolving ${idA}`);
  const a = await resolveOne(idA);
  log(`resolving ${idB}`);
  const b = await resolveOne(idB);

  if (!a) {
    console.error(`Could not resolve ${idA}`);
    process.exit(1);
  }
  if (!b) {
    console.error(`Could not resolve ${idB}`);
    process.exit(1);
  }

  console.log();
  console.log(c.primary("compare:"));
  console.log("  A. " + c.bold(a.title) + c.dim(` (${a.year ?? "?"})`));
  console.log("  B. " + c.bold(b.title) + c.dim(` (${b.year ?? "?"})`));
  console.log();

  log("generating comparison");
  const { text } = await complete({
    model: MODELS.smart,
    system: "You compare two academic papers side-by-side for a PhD researcher. Be honest, precise, and identify both similarities and meaningful differences. Output structured markdown.",
    prompt: `Paper A: "${a.title}" (${a.year ?? "?"})
Authors: ${a.authors.slice(0, 4).join(", ")}
Abstract: ${a.abstract.slice(0, 2000)}

---

Paper B: "${b.title}" (${b.year ?? "?"})
Authors: ${b.authors.slice(0, 4).join(", ")}
Abstract: ${b.abstract.slice(0, 2000)}

Output in this exact structure:

## At a glance
| Dimension | Paper A | Paper B |
|---|---|---|
| Problem | <one phrase> | <one phrase> |
| Method | <one phrase> | <one phrase> |
| Data | <one phrase> | <one phrase> |
| Eval | <one phrase> | <one phrase> |
| Key finding | <one phrase> | <one phrase> |

## What they share
3 bullet points: shared problem framing, shared methods, shared insights — whatever is most informative.

## How they differ
3 bullet points highlighting MEANINGFUL differences (not surface-level).

## When to use which
Two short paragraphs (≤80 words each):
- When does A's approach win
- When does B's approach win

## Open questions
2-3 bullets — open questions that arise from putting these two next to each other.

Be concrete. Avoid filler.`,
    maxTokens: 2000,
    temperature: 0.3,
  });

  console.log(text);
  console.log();
  console.log(c.dim(`cost: $${(totalCostUsd() - costBefore).toFixed(4)}`));
  console.log();
}
