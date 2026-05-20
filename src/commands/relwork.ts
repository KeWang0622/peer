/**
 * `peer relwork <topic>` — draft a related-work section.
 *
 * The "I'm writing the paper" command. Uses your library + S2/OpenAlex
 * to draft a structured Related Work section with proper citations.
 */
import { complete, MODELS, totalCostUsd } from "../lib/llm.js";
import { retrieve } from "../algorithms/rag.js";
import * as s2 from "../api/semantic-scholar.js";
import * as oa from "../api/openalex.js";
import { countPapers } from "../db/client.js";
import { c } from "../tui/colors.js";

interface ReferencedPaper {
  title: string;
  authors: string[];
  year: number | null;
  arxivId: string | null;
  doi: string | null;
  source: "library" | "external";
  citations: number;
  abstract: string;
}

export async function cmdRelwork(topic: string, opts: { verbose?: boolean } = {}): Promise<void> {
  const log = (m: string) => opts.verbose && console.log(c.dim(`  · ${m}`));
  const costBefore = totalCostUsd();

  console.log();
  console.log(c.primary("relwork: ") + c.italic(topic));
  console.log();

  const referenced: ReferencedPaper[] = [];

  // 1. Library hits
  if (countPapers() > 0) {
    try {
      log("retrieving from local library");
      const hits = await retrieve(topic, { k: 8, noteCharCap: 0 });
      for (const h of hits.hits) {
        if (!h.paper.abstract) continue;
        referenced.push({
          title: h.paper.title,
          authors: [], // library row doesn't keep authors cheaply; fine for relwork
          year: h.paper.year,
          arxivId: h.paper.arxiv_id,
          doi: h.paper.doi,
          source: "library",
          citations: h.paper.citations_count ?? 0,
          abstract: h.paper.abstract,
        });
      }
    } catch (err) {
      log(`library retrieve failed: ${(err as Error).message}`);
    }
  }

  // 2. External literature (top-cited recent)
  try {
    log("fetching external recent literature");
    const resp = await s2.searchPapers(topic, { limit: 15 });
    for (const p of resp.data) {
      if (!p.abstract || p.abstract.length < 80) continue;
      if (referenced.some((r) => r.title.toLowerCase() === p.title.toLowerCase())) continue;
      referenced.push({
        title: p.title,
        authors: (p.authors ?? []).map((a) => a.name),
        year: p.year ?? null,
        arxivId: p.externalIds?.ArXiv ?? null,
        doi: p.externalIds?.DOI ?? null,
        source: "external",
        citations: p.citationCount ?? 0,
        abstract: p.abstract,
      });
    }
  } catch (err) {
    log(`s2 failed, trying OpenAlex: ${(err as Error).message.slice(0, 60)}`);
    try {
      const resp = await oa.searchWorks(topic, { perPage: 15 });
      for (const w of resp.results) {
        const abs = oa.abstractFromInvertedIndex(w.abstract_inverted_index);
        if (!abs || abs.length < 80) continue;
        const title = w.title ?? w.display_name ?? "(untitled)";
        if (referenced.some((r) => r.title.toLowerCase() === title.toLowerCase())) continue;
        referenced.push({
          title,
          authors: (w.authorships ?? []).map((a) => a.author.display_name),
          year: w.publication_year ?? null,
          arxivId: oa.arxivIdFromOA(w),
          doi: oa.doiFromOA(w),
          source: "external",
          citations: w.cited_by_count ?? 0,
          abstract: abs,
        });
      }
    } catch {
      // continue with what we have
    }
  }

  if (referenced.length < 3) {
    console.error("Not enough literature found. Try a broader topic.");
    return;
  }

  log(`drafting from ${referenced.length} papers`);

  // 3. Generate the section
  const paperBlock = referenced
    .map((r, i) => {
      const idHint = r.arxivId ? `arxiv:${r.arxivId}` : r.doi ?? `paper-${i + 1}`;
      const auth = r.authors.slice(0, 3).join(", ") || "Unknown";
      return `[${i + 1}] cite-key: ${slugifyAuthorYear(r)} (${idHint})
Title: ${r.title}
Authors: ${auth}, Year: ${r.year ?? "?"}, Source: ${r.source}, Citations: ${r.citations}
Abstract: ${r.abstract.slice(0, 600)}`;
    })
    .join("\n\n");

  const { text: section, cost } = await complete({
    model: MODELS.smart,
    system: `You are drafting an academic Related Work section. Be honest, precise, and ground every claim in the provided papers. Use [author, year] inline citations matching the cite-keys given. Do not invent claims. If the literature is sparse on some sub-aspect, say so. Output Markdown that compiles cleanly to LaTeX.`,
    prompt: `Topic: ${topic}

You have ${referenced.length} papers to organize into a Related Work section. Cluster them into 3-5 thematic groups. Within each group:
- Open with one sentence framing the sub-area
- Discuss 2-3 key papers, citing them as [cite-key, year]
- Note tensions / open questions / limitations

End with a 'Gap' paragraph that positions our hypothetical work relative to the literature.

Papers available:

${paperBlock}

Output the section in Markdown, ~600-900 words. Use ## headings for thematic groups. Cite every claim.`,
    maxTokens: 3000,
    temperature: 0.35,
  });

  console.log(section);
  console.log();

  // BibTeX block for everything cited
  console.log("```bibtex");
  for (const r of referenced) {
    const key = slugifyAuthorYear(r);
    console.log(`@article{${key},`);
    console.log(`  title   = {${r.title}},`);
    console.log(`  author  = {${r.authors.join(" and ") || "Unknown"}},`);
    console.log(`  year    = {${r.year ?? "n.d."}},`);
    if (r.doi) console.log(`  doi     = {${r.doi}},`);
    if (r.arxivId) console.log(`  eprint  = {${r.arxivId}},\n  archivePrefix = {arXiv},`);
    console.log("}");
  }
  console.log("```");
  console.log();
  console.log(c.dim(`drafted ${referenced.length} papers · cost: $${(totalCostUsd() - costBefore).toFixed(4)}`));
  console.log();
}

function slugifyAuthorYear(r: ReferencedPaper): string {
  const lastName =
    r.authors[0]?.split(/\s+/).pop()?.toLowerCase().replace(/[^a-z]/g, "") || "anon";
  const year = r.year ?? "nd";
  const firstWord =
    r.title.toLowerCase().split(/\s+/).find((w) => w.length > 3)?.replace(/[^a-z0-9]/g, "") ?? "paper";
  return `${lastName}${year}${firstWord}`;
}
