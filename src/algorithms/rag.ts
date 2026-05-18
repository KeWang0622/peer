/**
 * Retrieval-augmented generation primitives for `prof ask`.
 *
 * Pipeline (v0.0.1):
 *   1. Embed query + all library papers (title + abstract).
 *   2. Rank by cosine similarity.
 *   3. Return top-K paper rows plus their note excerpts (if any).
 *
 * Embeddings are computed inline per-invocation (no persistent cache yet).
 * For libraries up to a few hundred papers this is fine on a researcher's
 * laptop and keeps state-management simple for v0.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { paths } from "../config/paths.js";
import { db, PaperRow } from "../db/client.js";
import { embed, CostEntry } from "../lib/llm.js";

export interface RetrievedPaper {
  paper: PaperRow;
  score: number;
  noteExcerpt: string | null;
}

export interface RetrievalResult {
  query: string;
  hits: RetrievedPaper[];
  libraryPaperCount: number;
  embedCost: CostEntry;
}

export interface RetrievalOptions {
  k?: number;
  noteCharCap?: number;
  onProgress?: (step: string, detail?: string) => void;
}

const DEFAULT_K = 8;
const DEFAULT_NOTE_CAP = 2000;

/** Cosine similarity for two equal-length numeric vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 0;
  return dot / denom;
}

/** Build the chunk used for retrieval embedding for a paper. */
export function paperChunk(p: PaperRow): string {
  const title = p.title?.trim() ?? "";
  const abstract = (p.abstract ?? "").trim();
  return abstract.length > 0 ? `${title}\n\n${abstract}` : title;
}

/** Best-effort lookup of the markdown note for a paper. */
export function readNoteForPaper(p: PaperRow, charCap: number = DEFAULT_NOTE_CAP): string | null {
  const slug = makeSlug(p.title, p.year);
  const notePath = path.join(paths.papersNotes(), `${slug}.md`);
  if (!fs.existsSync(notePath)) return null;
  try {
    const raw = fs.readFileSync(notePath, "utf-8");
    return raw.length > charCap ? raw.slice(0, charCap) : raw;
  } catch {
    return null;
  }
}

/** Mirrors the slug format used by `prof read` so retrieval can find notes. */
function makeSlug(title: string, year: number | null): string {
  const yearPart = year ? `${year}-` : "";
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return `${yearPart}${slug}`;
}

/** Citation tag used in prompts and rendered sources. */
export function citationTag(p: PaperRow): string {
  if (p.arxiv_id) return `arxiv:${p.arxiv_id}`;
  if (p.doi) return `doi:${p.doi}`;
  if (p.s2_id) return `s2:${p.s2_id}`;
  return p.id;
}

/** Pull every paper currently in the library. */
export function loadLibrary(): PaperRow[] {
  return db().prepare<[], PaperRow>("SELECT * FROM papers ORDER BY ingested_at DESC").all();
}

/**
 * Retrieve the top-K papers most similar to the query, attaching note excerpts.
 *
 * The query embedding and chunk embeddings are computed via the same
 * `text-embedding-3-small` model, so cosine similarity is well-defined.
 */
export async function retrieve(query: string, opts: RetrievalOptions = {}): Promise<RetrievalResult> {
  const onProgress = opts.onProgress ?? (() => {});
  const k = opts.k ?? DEFAULT_K;
  const noteCap = opts.noteCharCap ?? DEFAULT_NOTE_CAP;

  const library = loadLibrary();
  onProgress("loaded", `${library.length} papers in library`);

  if (library.length === 0) {
    return {
      query,
      hits: [],
      libraryPaperCount: 0,
      embedCost: { model: "text-embedding-3-small", inputTokens: 0, outputTokens: 0, costUsd: 0 },
    };
  }

  const chunks = library.map(paperChunk);
  onProgress("embedding", `${chunks.length + 1} chunks (query + library)`);
  const { vectors, cost: embedCost } = await embed([query, ...chunks]);

  const queryVec = vectors[0];
  if (!queryVec) {
    throw new Error("Embedding returned no query vector");
  }

  const scored: RetrievedPaper[] = library.map((paper, i) => {
    const chunkVec = vectors[i + 1] ?? [];
    return {
      paper,
      score: cosineSimilarity(queryVec, chunkVec),
      noteExcerpt: null,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, Math.min(k, scored.length));

  for (const hit of top) {
    hit.noteExcerpt = readNoteForPaper(hit.paper, noteCap);
  }

  onProgress("retrieved", `top ${top.length}`);
  return {
    query,
    hits: top,
    libraryPaperCount: library.length,
    embedCost,
  };
}

/** Format the retrieved context block injected into the prompt. */
export function buildContextBlock(hits: RetrievedPaper[]): string {
  return hits
    .map((h, i) => {
      const p = h.paper;
      const header = `[${i + 1}] ${p.title}${p.year ? ` (${p.year})` : ""} — [${citationTag(p)}]`;
      const abstract = p.abstract?.trim() ? `Abstract: ${p.abstract.trim()}` : "Abstract: (not available)";
      const note = h.noteExcerpt ? `Note excerpt:\n${h.noteExcerpt.trim()}` : "Note excerpt: (no local note yet)";
      return `${header}\n${abstract}\n\n${note}`;
    })
    .join("\n\n---\n\n");
}
