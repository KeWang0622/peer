/**
 * `prof collab "<topic|author>"` — find potential collaborators / labs.
 *
 * Two modes:
 *   1. Topic: find active researchers publishing on this topic recently.
 *   2. Author name: find their frequent co-authors + adjacent researchers.
 *
 * Uses Semantic Scholar + OpenAlex. No auth needed.
 */
import * as s2 from "../api/semantic-scholar.js";
import * as oa from "../api/openalex.js";
import { complete, MODELS, totalCostUsd } from "../lib/llm.js";

interface AuthorRank {
  name: string;
  s2Id: string | null;
  paperCount: number;
  totalCitations: number;
  recentPapers: string[];
  affiliations: Set<string>;
}

export async function cmdCollab(input: string, opts: { verbose?: boolean } = {}): Promise<void> {
  const log = (m: string) => opts.verbose && console.log(`  · ${m}`);
  const costBefore = totalCostUsd();
  const trimmed = input.trim();

  console.log(`\nFinding collaborators for: "${trimmed}"\n`);

  // Search papers — works for both topic and author name as query
  log(`searching recent literature (last 5 years)`);
  let papers: s2.S2Paper[] = [];

  try {
    const resp = await s2.searchPapers(trimmed, { limit: 50, year: `${new Date().getFullYear() - 5}-${new Date().getFullYear()}` });
    papers = resp.data.filter((p) => p.abstract && (p.authors?.length ?? 0) > 0);
  } catch (err) {
    log(`s2 failed: ${(err as Error).message.slice(0, 80)} — trying OpenAlex`);
    try {
      const resp = await oa.searchWorks(trimmed, { perPage: 50, minYear: new Date().getFullYear() - 5 });
      papers = resp.results.map((w): s2.S2Paper => ({
        paperId: w.id,
        externalIds: { ArXiv: oa.arxivIdFromOA(w) ?? undefined, DOI: oa.doiFromOA(w) ?? undefined },
        title: w.title ?? w.display_name ?? "",
        abstract: oa.abstractFromInvertedIndex(w.abstract_inverted_index),
        year: w.publication_year ?? null,
        venue: w.primary_location?.source?.display_name ?? null,
        citationCount: w.cited_by_count ?? 0,
        authors: (w.authorships ?? []).map((a) => ({
          authorId: a.author.id ?? null,
          name: a.author.display_name,
          hIndex: null,
        })),
      }));
    } catch (err2) {
      console.error("Both Semantic Scholar and OpenAlex unavailable.");
      process.exit(1);
    }
  }

  if (papers.length === 0) {
    console.log("No recent papers found. Try a more specific topic or author name.");
    return;
  }

  log(`${papers.length} papers in the last 5 years`);

  // Aggregate authors by paper count + total citations
  const authorMap = new Map<string, AuthorRank>();
  for (const p of papers) {
    for (const a of p.authors ?? []) {
      if (!a.name) continue;
      const key = a.authorId ?? a.name.toLowerCase();
      const existing = authorMap.get(key) ?? {
        name: a.name,
        s2Id: a.authorId,
        paperCount: 0,
        totalCitations: 0,
        recentPapers: [],
        affiliations: new Set(),
      };
      existing.paperCount += 1;
      existing.totalCitations += p.citationCount ?? 0;
      if (existing.recentPapers.length < 3) existing.recentPapers.push(p.title);
      authorMap.set(key, existing);
    }
  }

  const ranked = Array.from(authorMap.values())
    .filter((a) => a.paperCount >= 2)        // active = at least 2 recent papers
    .sort((a, b) => {
      // Score: paper count primary, citations secondary
      const scoreA = a.paperCount * 1000 + Math.log10(a.totalCitations + 1);
      const scoreB = b.paperCount * 1000 + Math.log10(b.totalCitations + 1);
      return scoreB - scoreA;
    })
    .slice(0, 12);

  if (ranked.length === 0) {
    console.log("No author appears more than once in the last 5 years of literature.");
    console.log("Either this topic is very fragmented, or the query needs to be broader.");
    return;
  }

  console.log("Active researchers in this area:\n");
  ranked.forEach((author, i) => {
    console.log(`${i + 1}. \x1b[1m${author.name}\x1b[0m`);
    console.log(`   ${author.paperCount} recent papers · ${author.totalCitations} total citations`);
    if (author.recentPapers[0]) {
      console.log(`   \x1b[2m"${truncate(author.recentPapers[0], 80)}"\x1b[0m`);
    }
    if (author.s2Id) {
      console.log(`   \x1b[36mhttps://www.semanticscholar.org/author/${author.s2Id}\x1b[0m`);
    }
    console.log();
  });

  // LLM-based "natural collaboration suggestions" — small narrative output
  try {
    log("generating collaboration angles");
    const { text } = await complete({
      model: MODELS.cheap,
      system: "You suggest research collaboration angles based on author publication patterns.",
      prompt: `A researcher is interested in: "${trimmed}"

Active researchers in this area, ranked by recent activity:
${ranked.slice(0, 8).map((a, i) => `${i + 1}. ${a.name} (${a.paperCount} papers, "${a.recentPapers[0] ?? ""}")`).join("\n")}

Write a 2-paragraph note (~150 words) suggesting:
- Which 2-3 of these researchers are most likely worth reaching out to and why
- What concrete angle / shared interest could open the conversation

Be specific. No fluff.`,
      maxTokens: 500,
      temperature: 0.4,
    });
    console.log("Collaboration angles:\n");
    console.log(text);
    console.log();
  } catch (err) {
    log(`note generation failed: ${(err as Error).message}`);
  }

  console.log(`\x1b[2mcost: $${(totalCostUsd() - costBefore).toFixed(4)}\x1b[0m\n`);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
