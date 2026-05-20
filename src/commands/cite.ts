/**
 * `peer cite "<claim>"` — find citation candidates for a writing claim.
 *
 * Flow:
 *   1. Retrieve local library papers with the same RAG primitive used by `peer ask`.
 *   2. Search external literature via Semantic Scholar, with OpenAlex fallback.
 *   3. Ask the LLM to pick the best 3-5 citations.
 *   4. Print full citation info, BibTeX entries, and a LaTeX cite command.
 */
import { ensureDirs } from "../config/paths.js";
import { buildContextBlock, retrieve, type RetrievedPaper } from "../algorithms/rag.js";
import * as s2 from "../api/semantic-scholar.js";
import * as oa from "../api/openalex.js";
import { complete, MODELS, totalCostUsd } from "../lib/llm.js";
import { countPapers, db, paperCanonicalId, upsertPaper, type PaperRow } from "../db/client.js";

export interface CiteOptions {
  verbose?: boolean;
}

interface CandidatePaper {
  id: string;
  source: "local" | "semantic-scholar" | "openalex";
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
  localScore?: number;
  rankReason?: string;
}

interface RankingJson {
  selected?: Array<{ id?: string; reason?: string } | string>;
}

const MAX_LOCAL = 5;
const MAX_EXTERNAL = 20;
const MAX_CITED = 5;

export async function cmdCite(claim: string, opts: CiteOptions = {}): Promise<void> {
  ensureDirs();
  const log = (msg: string) => {
    if (opts.verbose) console.log(`  · ${msg}`);
  };

  console.log(`\n# Citation candidates\n\nClaim: ${claim}\n`);

  const local = await searchLocalLibrary(claim, log);
  const external = await searchExternal(claim, log);
  const candidates = dedupeCandidates([...local, ...external]);

  if (candidates.length === 0) {
    console.log("No citation candidates found locally or externally.");
    return;
  }

  const selected = await rankCandidates(claim, candidates, log);
  const withKeys = assignBibtexKeys(selected);

  console.log("## Papers\n");
  withKeys.forEach((p, i) => {
    const source = p.source === "local" ? "local library" : p.source;
    console.log(`${i + 1}. **${p.title}**`);
    console.log(`   ${formatAuthors(p.authors)}${p.year ? ` (${p.year})` : ""}${p.venue ? `, ${p.venue}` : ""}.`);
    console.log(`   Source: ${source} · citations: ${p.citations}${p.localScore != null ? ` · local similarity: ${p.localScore.toFixed(3)}` : ""}`);
    if (p.doi || p.arxivId || p.s2Id) {
      console.log(`   IDs: ${[p.doi ? `DOI ${p.doi}` : null, p.arxivId ? `arXiv ${p.arxivId}` : null, p.s2Id ? `S2 ${p.s2Id}` : null].filter(Boolean).join(" · ")}`);
    }
    if (p.rankReason) console.log(`   Why: ${p.rankReason}`);
    console.log("");
  });

  console.log("## BibTeX\n");
  console.log("```bibtex");
  for (const p of withKeys) console.log(formatBibtex(p));
  console.log("```\n");

  console.log("## LaTeX\n");
  console.log("```tex");
  console.log(`\\cite{${withKeys.map((p) => p.bibtexKey).join(",")}}`);
  console.log("```\n");
  console.log(`Cost total this session: $${totalCostUsd().toFixed(3)}\n`);
}

async function searchLocalLibrary(claim: string, log: (msg: string) => void): Promise<CandidatePaper[]> {
  if (countPapers() === 0) {
    log("local library empty; skipping RAG search");
    return [];
  }

  try {
    log("searching local library");
    const retrieval = await retrieve(claim, {
      k: MAX_LOCAL,
      noteCharCap: 1200,
      onProgress: (step, detail) => log(`${step}${detail ? `: ${detail}` : ""}`),
    });
    return retrieval.hits.map(localHitToCandidate);
  } catch (err) {
    log(`local retrieval failed: ${(err as Error).message}`);
    return [];
  }
}

async function searchExternal(claim: string, log: (msg: string) => void): Promise<CandidatePaper[]> {
  let out: CandidatePaper[] = [];

  try {
    log("searching Semantic Scholar");
    const resp = await s2.searchPapers(claim, { limit: MAX_EXTERNAL });
    out = resp.data.map(s2ToCandidate);
  } catch (err) {
    log(`Semantic Scholar failed: ${(err as Error).message}`);
  }

  if (out.length < 5) {
    try {
      log("searching OpenAlex fallback");
      const resp = await oa.searchWorks(claim, { perPage: MAX_EXTERNAL });
      out = [...out, ...resp.results.map(oaToCandidate)];
    } catch (err) {
      log(`OpenAlex failed: ${(err as Error).message}`);
    }
  }

  for (const p of out) persistCandidate(p);
  return out.sort((a, b) => b.citations - a.citations).slice(0, MAX_EXTERNAL);
}

async function rankCandidates(
  claim: string,
  candidates: CandidatePaper[],
  log: (msg: string) => void,
): Promise<CandidatePaper[]> {
  const compact = candidates.slice(0, 18);
  const localContext = compact.some((p) => p.source === "local")
    ? `\nLocal library context:\n${buildContextBlock(
        compact
          .filter((p) => p.source === "local")
          .slice(0, MAX_LOCAL)
          .map(candidateToRetrievedPaper),
      )}\n`
    : "";

  const paperBlock = compact
    .map((p, i) => {
      const authors = formatAuthors(p.authors.slice(0, 4));
      const abstract = p.abstract ? p.abstract.slice(0, 900) : "(no abstract)";
      return `[${i + 1}] id=${p.id}
Title: ${p.title}
Authors: ${authors}
Year: ${p.year ?? "unknown"}
Venue: ${p.venue ?? "unknown"}
Citations: ${p.citations}
Source: ${p.source}${p.localScore != null ? `, local similarity ${p.localScore.toFixed(3)}` : ""}
Abstract: ${abstract}`;
    })
    .join("\n\n");

  try {
    log(`ranking with ${MODELS.cheap}`);
    const { text } = await complete({
      model: MODELS.cheap,
      system: "You select academic citations for a writing claim. Output JSON only.",
      prompt: `Claim: ${claim}

Pick the best 3-5 papers that support, introduce, or directly discuss this claim. Prefer papers that are directly relevant over merely highly cited. Include local-library papers when they are relevant.

${localContext}
Candidates:

${paperBlock}

Output ONLY JSON in this exact shape:
{
  "selected": [
    { "id": "candidate-id", "reason": "brief reason this paper fits the claim" }
  ]
}`,
      maxTokens: 1200,
      temperature: 0.2,
    });

    const parsed = parseRanking(text);
    const selected: CandidatePaper[] = [];
    for (const entry of parseSelectedIds(parsed)) {
      const candidate = compact.find((p) => p.id === entry.id);
      if (candidate) selected.push({ ...candidate, rankReason: entry.reason });
      if (selected.length >= MAX_CITED) break;
    }

    if (selected.length > 0) return selected;
  } catch (err) {
    log(`LLM ranking failed: ${(err as Error).message}`);
  }

  return [...candidates]
    .sort((a, b) => (b.localScore ?? 0) - (a.localScore ?? 0) || b.citations - a.citations)
    .slice(0, MAX_CITED);
}

function localHitToCandidate(hit: RetrievedPaper): CandidatePaper {
  const p = hit.paper;
  return {
    id: candidateId({
      doi: p.doi,
      arxivId: p.arxiv_id,
      s2Id: p.s2_id,
      title: p.title,
      year: p.year,
    }),
    source: "local",
    title: p.title,
    authors: authorsForPaperRow(p),
    year: p.year,
    venue: p.venue,
    doi: p.doi,
    arxivId: p.arxiv_id,
    s2Id: p.s2_id,
    abstract: p.abstract,
    citations: p.citations_count ?? 0,
    references: p.references_count ?? 0,
    localScore: hit.score,
  };
}

function candidateToRetrievedPaper(candidate: CandidatePaper): RetrievedPaper {
  return {
    score: candidate.localScore ?? 0,
    noteExcerpt: null,
    paper: {
      id: candidate.id,
      s2_id: candidate.s2Id,
      doi: candidate.doi,
      arxiv_id: candidate.arxivId,
      title: candidate.title,
      abstract: candidate.abstract,
      year: candidate.year,
      venue: candidate.venue,
      citations_count: candidate.citations,
      references_count: candidate.references,
      pdf_path: null,
      source: candidate.source,
      raw_json: null,
      ingested_at: 0,
      layer2_extracted_at: null,
    },
  };
}

function s2ToCandidate(p: s2.S2Paper): CandidatePaper {
  return {
    id: candidateId({
      doi: p.externalIds?.DOI ?? null,
      arxivId: p.externalIds?.ArXiv ?? null,
      s2Id: p.paperId,
      title: p.title,
      year: p.year ?? null,
    }),
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

function oaToCandidate(w: oa.OAWork): CandidatePaper {
  const title = w.title ?? w.display_name ?? "(untitled)";
  const doi = oa.doiFromOA(w);
  const arxivId = oa.arxivIdFromOA(w);
  const s2Id = w.id.replace(/^https?:\/\/openalex\.org\//, "oa-");
  return {
    id: candidateId({ doi, arxivId, s2Id, title, year: w.publication_year ?? null }),
    source: "openalex",
    title,
    authors: (w.authorships ?? []).map((a) => a.author.display_name).filter((name) => name.length > 0),
    year: w.publication_year ?? null,
    venue: w.primary_location?.source?.display_name ?? null,
    doi,
    arxivId,
    s2Id,
    abstract: oa.abstractFromInvertedIndex(w.abstract_inverted_index),
    citations: w.cited_by_count ?? 0,
    references: 0,
  };
}

function persistCandidate(p: CandidatePaper): void {
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
    // Non-fatal: citation rendering should still work even if cache persistence fails.
  }
}

function authorsForPaperRow(p: PaperRow): string[] {
  const rawAuthors = authorsFromRawJson(p.raw_json);
  if (rawAuthors.length > 0) return rawAuthors;
  try {
    return db()
      .prepare<[string], { name: string }>(
        `SELECT a.name
         FROM authored au
         JOIN authors a ON a.id = au.author_id
         WHERE au.paper_id = ?
         ORDER BY au.position ASC`,
      )
      .all(p.id)
      .map((row) => row.name);
  } catch {
    return [];
  }
}

function authorsFromRawJson(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as {
      authors?: Array<{ name?: unknown }>;
      authorships?: Array<{ author?: { display_name?: unknown } }>;
    };
    if (Array.isArray(parsed.authors)) {
      return parsed.authors
        .map((a) => (typeof a.name === "string" ? a.name.trim() : ""))
        .filter((name) => name.length > 0);
    }
    if (Array.isArray(parsed.authorships)) {
      return parsed.authorships
        .map((a) => (typeof a.author?.display_name === "string" ? a.author.display_name.trim() : ""))
        .filter((name) => name.length > 0);
    }
  } catch {
    return [];
  }
  return [];
}

function dedupeCandidates(candidates: CandidatePaper[]): CandidatePaper[] {
  const byKey = new Map<string, CandidatePaper>();
  for (const p of candidates) {
    const key = dedupeKey(p);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, p);
      continue;
    }
    byKey.set(key, chooseBetter(existing, p));
  }
  return [...byKey.values()];
}

function chooseBetter(a: CandidatePaper, b: CandidatePaper): CandidatePaper {
  if (a.source === "local" && b.source !== "local") {
    return { ...a, citations: Math.max(a.citations, b.citations), abstract: a.abstract ?? b.abstract };
  }
  if (b.source === "local" && a.source !== "local") {
    return { ...b, citations: Math.max(a.citations, b.citations), abstract: b.abstract ?? a.abstract };
  }
  return b.citations > a.citations ? b : a;
}

function dedupeKey(p: CandidatePaper): string {
  if (p.doi) return `doi:${p.doi.toLowerCase()}`;
  if (p.arxivId) return `arxiv:${p.arxivId.toLowerCase()}`;
  if (p.s2Id) return `s2:${p.s2Id}`;
  return `title:${normalizeTitle(p.title)}:${p.year ?? 0}`;
}

function candidateId(input: {
  doi: string | null;
  arxivId: string | null;
  s2Id: string | null;
  title: string;
  year: number | null;
}): string {
  if (input.doi) return `doi:${input.doi.toLowerCase()}`;
  if (input.arxivId) return `arxiv:${input.arxivId.toLowerCase()}`;
  if (input.s2Id) return `s2:${input.s2Id}`;
  return `title:${normalizeTitle(input.title)}:${input.year ?? 0}`;
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

function parseRanking(text: string): RankingJson {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced?.[1] ?? text;
  const objectMatch = raw.match(/\{[\s\S]*\}/);
  return JSON.parse((objectMatch?.[0] ?? raw).trim()) as RankingJson;
}

function parseSelectedIds(parsed: RankingJson): Array<{ id: string; reason: string | undefined }> {
  const selected = Array.isArray(parsed.selected) ? parsed.selected : [];
  return selected
    .map((item) => {
      if (typeof item === "string") return { id: item, reason: undefined };
      if (item && typeof item.id === "string") return { id: item.id, reason: item.reason };
      return null;
    })
    .filter((item): item is { id: string; reason: string | undefined } => item !== null);
}

function assignBibtexKeys<T extends CandidatePaper>(papers: T[]): Array<T & { bibtexKey: string }> {
  const used = new Map<string, number>();
  return papers.map((p) => {
    const base = bibtexKeyBase(p);
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    const bibtexKey = n === 0 ? base : `${base}${n + 1}`;
    return { ...p, bibtexKey };
  });
}

function bibtexKeyBase(p: CandidatePaper): string {
  const firstAuthor = p.authors[0] ?? firstTitleWord(p.title);
  const lastName = firstAuthor.trim().split(/\s+/).at(-1) ?? "paper";
  const year = p.year ? String(p.year) : "nodate";
  const titleWord = firstTitleWord(p.title);
  return `${asciiSlug(lastName)}${year}${asciiSlug(titleWord)}`.slice(0, 40) || "paper";
}

function firstTitleWord(title: string): string {
  return title.replace(/[^A-Za-z0-9 ]+/g, " ").trim().split(/\s+/).find((w) => w.length > 2) ?? "paper";
}

function asciiSlug(s: string): string {
  return s.normalize("NFKD").replace(/[^\w\s-]/g, "").replace(/[_\s-]+/g, "").toLowerCase();
}

function formatAuthors(authors: string[]): string {
  if (authors.length === 0) return "Unknown authors";
  if (authors.length <= 3) return authors.join(", ");
  return `${authors.slice(0, 3).join(", ")} et al.`;
}

function formatBibtex(p: CandidatePaper & { bibtexKey: string }): string {
  const fields: Array<[string, string]> = [
    ["title", p.title],
    ["author", p.authors.length > 0 ? p.authors.join(" and ") : "Unknown"],
  ];
  if (p.year) fields.push(["year", String(p.year)]);
  if (p.venue) fields.push(["journal", p.venue]);
  if (p.doi) fields.push(["doi", p.doi]);
  if (p.arxivId) {
    fields.push(["eprint", p.arxivId]);
    fields.push(["archivePrefix", "arXiv"]);
  }
  if (p.s2Id && !p.s2Id.startsWith("oa-")) fields.push(["semanticScholarId", p.s2Id]);

  const body = fields.map(([key, value]) => `  ${key} = {${bibtexEscape(value)}},`).join("\n");
  return `@article{${p.bibtexKey},\n${body}\n}\n`;
}

function bibtexEscape(value: string): string {
  return value.replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
}
