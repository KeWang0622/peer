/**
 * `peer gap "<X> and <Y>"` — look for sparse intersections between topics.
 *
 * The command estimates whether a topic intersection is well explored by
 * searching external indexes, then asks the LLM for concrete research
 * questions when the intersection is sparse.
 */
import { ensureDirs } from "../config/paths.js";
import * as s2 from "../api/semantic-scholar.js";
import * as oa from "../api/openalex.js";
import { complete, MODELS, totalCostUsd } from "../lib/llm.js";
import { paperCanonicalId, upsertPaper } from "../db/client.js";

export interface GapOptions {
  verbose?: boolean;
}

interface GapPaper {
  source: "semantic-scholar" | "openalex";
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  doi: string | null;
  arxivId: string | null;
  s2Id: string | null;
  abstract: string | null;
  citations: number;
  references: number;
}

interface IntersectionSearch {
  topics: string[];
  query: string;
  provider: "semantic-scholar" | "openalex";
  total: number;
  papers: GapPaper[];
}

const SEARCH_LIMIT = 30;
const TOP_PAPERS = 5;
const SPARSE_THRESHOLD = 25;

export async function cmdGap(input: string, opts: GapOptions = {}): Promise<void> {
  ensureDirs();
  const log = (msg: string) => {
    if (opts.verbose) console.log(`  · ${msg}`);
  };

  const topics = parseTopics(input);
  if (topics.length === 0) {
    throw new Error("No topics found. Usage: peer gap \"<X> and <Y>\"");
  }

  const intersections = buildIntersections(topics);
  console.log(`\n# Research gaps\n\nTopics: ${topics.join(", ")}\n`);

  for (const item of intersections) {
    const search = await searchIntersection(item, log);
    search.papers.forEach(persistPaper);

    console.log(`## ${item.join(" + ")}\n`);
    console.log(`Intersection size: **${search.total}** papers found (${search.provider}, query: \`${search.query}\`).\n`);

    const top = [...search.papers].sort((a, b) => b.citations - a.citations).slice(0, TOP_PAPERS);
    if (isSparse(search)) {
      console.log("Status: **opportunity** — this intersection appears sparse.\n");
      const questions = await generateQuestions(search, log);
      console.log("### Research questions\n");
      console.log(questions.trim());
      console.log("");
      if (top.length > 0) {
        console.log("### Nearest papers\n");
        top.forEach((p, i) => console.log(`${i + 1}. ${formatPaperLine(p)}`));
        console.log("");
      }
    } else {
      console.log("Status: **well-explored** — there is already a visible literature at this intersection.\n");
      console.log("### Top papers\n");
      top.forEach((p, i) => console.log(`${i + 1}. ${formatPaperLine(p)}`));
      console.log("");
    }
  }

  console.log(`Cost total this session: $${totalCostUsd().toFixed(3)}\n`);
}

function parseTopics(input: string): string[] {
  const normalized = input
    .replace(/\s*&\s*/g, ",")
    .replace(/\s+\+\s+/g, ",")
    .trim();
  const parts = normalized
    .split(/\s*,\s*|\s+\band\b\s+/i)
    .map((p) => p.trim().replace(/^["']|["']$/g, ""))
    .filter((p) => p.length > 0);
  return [...new Set(parts)];
}

function buildIntersections(topics: string[]): string[][] {
  if (topics.length <= 2) return [topics];

  const out: string[][] = [];
  for (let i = 0; i < topics.length; i++) {
    for (let j = i + 1; j < topics.length; j++) {
      const a = topics[i];
      const b = topics[j];
      if (a && b) out.push([a, b]);
    }
  }
  out.push(topics);
  return out;
}

async function searchIntersection(topics: string[], log: (msg: string) => void): Promise<IntersectionSearch> {
  const query = topics.join(" ");

  try {
    log(`searching Semantic Scholar: ${query}`);
    const resp = await s2.searchPapers(query, { limit: SEARCH_LIMIT });
    const papers = resp.data.map(s2ToPaper);
    if (papers.length > 0 || resp.total > 0) {
      return {
        topics,
        query,
        provider: "semantic-scholar",
        total: resp.total,
        papers,
      };
    }
  } catch (err) {
    log(`Semantic Scholar failed: ${(err as Error).message}`);
  }

  log(`searching OpenAlex fallback: ${query}`);
  const resp = await oa.searchWorks(query, { perPage: SEARCH_LIMIT });
  return {
    topics,
    query,
    provider: "openalex",
    total: resp.meta.count,
    papers: resp.results.map(oaToPaper),
  };
}

function isSparse(search: IntersectionSearch): boolean {
  return search.total < SPARSE_THRESHOLD || search.papers.length < 3;
}

async function generateQuestions(search: IntersectionSearch, log: (msg: string) => void): Promise<string> {
  const paperBlock =
    search.papers.length > 0
      ? search.papers
          .slice(0, 8)
          .map(
            (p, i) =>
              `${i + 1}. ${p.title} (${p.year ?? "?"}, ${p.citations} cites)\n` +
              `   Abstract: ${p.abstract ? p.abstract.slice(0, 700) : "(no abstract)"}`,
          )
          .join("\n\n")
      : "(No direct papers found.)";

  try {
    log(`generating questions with ${MODELS.cheap}`);
    const { text } = await complete({
      model: MODELS.cheap,
      system: "You identify concrete research opportunities at sparse intersections. Output markdown bullets only.",
      prompt: `Topics: ${search.topics.join(", ")}
Intersection size estimate: ${search.total} papers

Nearby/direct papers:
${paperBlock}

Generate 3-5 specific, testable research questions for this sparse intersection. Avoid generic "apply X to Y" phrasing unless you specify the mechanism, evaluation target, and why the intersection is underexplored. Output markdown bullets only.`,
      maxTokens: 900,
      temperature: 0.5,
    });
    return text;
  } catch (err) {
    log(`question generation failed: ${(err as Error).message}`);
    return fallbackQuestions(search.topics);
  }
}

function fallbackQuestions(topics: string[]): string {
  const label = topics.join(" + ");
  return [
    `- What benchmark or experimental setting would make progress on ${label} measurable rather than anecdotal?`,
    `- Which assumptions from ${topics[0] ?? "one topic"} break when combined with ${topics[1] ?? "the other topic"}?`,
    `- Can a minimal method at this intersection outperform strong single-topic baselines under matched compute and data budgets?`,
  ].join("\n");
}

function s2ToPaper(p: s2.S2Paper): GapPaper {
  return {
    source: "semantic-scholar",
    title: p.title,
    authors: (p.authors ?? []).map((a) => a.name).filter((name) => name.length > 0),
    year: p.year ?? null,
    venue: p.venue ?? null,
    doi: p.externalIds?.DOI ?? null,
    arxivId: p.externalIds?.ArXiv ?? null,
    s2Id: p.paperId,
    abstract: p.abstract ?? null,
    citations: p.citationCount ?? 0,
    references: p.referenceCount ?? 0,
  };
}

function oaToPaper(w: oa.OAWork): GapPaper {
  const title = w.title ?? w.display_name ?? "(untitled)";
  return {
    source: "openalex",
    title,
    authors: (w.authorships ?? []).map((a) => a.author.display_name).filter((name) => name.length > 0),
    year: w.publication_year ?? null,
    venue: w.primary_location?.source?.display_name ?? null,
    doi: oa.doiFromOA(w),
    arxivId: oa.arxivIdFromOA(w),
    s2Id: w.id.replace(/^https?:\/\/openalex\.org\//, "oa-"),
    abstract: oa.abstractFromInvertedIndex(w.abstract_inverted_index),
    citations: w.cited_by_count ?? 0,
    references: 0,
  };
}

function persistPaper(p: GapPaper): void {
  if (!p.title || p.title === "(untitled)") return;
  try {
    upsertPaper({
      id: paperCanonicalId({
        arxiv_id: p.arxivId,
        doi: p.doi,
        s2_id: p.s2Id,
        title: p.title,
        year: p.year,
      }),
      s2_id: p.s2Id,
      doi: p.doi,
      arxiv_id: p.arxivId,
      title: p.title,
      abstract: p.abstract,
      year: p.year,
      venue: p.venue,
      citations_count: p.citations,
      references_count: p.references,
      pdf_path: null,
      source: p.source,
      raw_json: JSON.stringify(p),
    });
  } catch {
    // Non-fatal cache write.
  }
}

function formatPaperLine(p: GapPaper): string {
  const authors = formatAuthors(p.authors);
  const ids = [p.doi ? `DOI ${p.doi}` : null, p.arxivId ? `arXiv ${p.arxivId}` : null].filter(Boolean).join(" · ");
  return `**${p.title}** (${p.year ?? "?"}) — ${authors}${p.venue ? `, ${p.venue}` : ""} · ${p.citations} citations${ids ? ` · ${ids}` : ""}`;
}

function formatAuthors(authors: string[]): string {
  if (authors.length === 0) return "Unknown authors";
  if (authors.length <= 3) return authors.join(", ");
  return `${authors.slice(0, 3).join(", ")} et al.`;
}
