/**
 * Semantic Scholar Graph API client.
 * Docs: https://api.semanticscholar.org/api-docs/graph
 *
 * Free, public API. Optional API key for higher rate limits via
 * x-api-key header. Set SEMANTIC_SCHOLAR_API_KEY env var.
 */
import { fetchWithRetry } from "../lib/retry.js";

const BASE = "https://api.semanticscholar.org/graph/v1";

const DEFAULT_FIELDS = [
  "paperId",
  "externalIds",
  "title",
  "abstract",
  "year",
  "venue",
  "citationCount",
  "referenceCount",
  "authors.authorId",
  "authors.name",
  "authors.hIndex",
].join(",");

const REFS_CITES_FIELDS = [
  "paperId",
  "externalIds",
  "title",
  "abstract",
  "year",
  "venue",
  "citationCount",
  "authors.authorId",
  "authors.name",
  "isInfluential",
].join(",");

function headers(): Record<string, string> {
  const h: Record<string, string> = {
    "User-Agent": "prof/0.0.1 (https://github.com/kewang/prof)",
    "Accept": "application/json",
  };
  const key = process.env.SEMANTIC_SCHOLAR_API_KEY;
  if (key) h["x-api-key"] = key;
  return h;
}

export interface S2Author {
  authorId: string | null;
  name: string;
  hIndex?: number | null;
}

export interface S2Paper {
  paperId: string;
  externalIds?: {
    DOI?: string;
    ArXiv?: string;
    [k: string]: string | undefined;
  };
  title: string;
  abstract?: string | null;
  year?: number | null;
  venue?: string | null;
  citationCount?: number;
  referenceCount?: number;
  authors?: S2Author[];
  isInfluential?: boolean; // only present on refs/cites endpoints
}

export interface S2SearchResp {
  total: number;
  offset: number;
  next?: number;
  data: S2Paper[];
}

export interface S2RefsCitesResp<T = unknown> {
  offset: number;
  next?: number;
  data: T[];
}

/** Search papers by relevance. */
export async function searchPapers(
  query: string,
  opts: { limit?: number; offset?: number; fieldsOfStudy?: string[]; year?: string } = {},
): Promise<S2SearchResp> {
  const params = new URLSearchParams({
    query,
    limit: String(opts.limit ?? 20),
    offset: String(opts.offset ?? 0),
    fields: DEFAULT_FIELDS,
  });
  if (opts.fieldsOfStudy?.length) {
    params.set("fieldsOfStudy", opts.fieldsOfStudy.join(","));
  }
  if (opts.year) params.set("year", opts.year);

  const url = `${BASE}/paper/search?${params.toString()}`;
  const resp = await fetchWithRetry(url, { headers: headers() });
  if (!resp.ok) {
    throw new Error(`S2 search failed ${resp.status}: ${await resp.text()}`);
  }
  return (await resp.json()) as S2SearchResp;
}

/** Look up a single paper by an identifier. */
export async function getPaper(id: string): Promise<S2Paper> {
  const url = `${BASE}/paper/${encodeURIComponent(id)}?fields=${DEFAULT_FIELDS}`;
  const resp = await fetchWithRetry(url, { headers: headers() });
  if (!resp.ok) {
    throw new Error(`S2 getPaper(${id}) failed ${resp.status}: ${await resp.text()}`);
  }
  return (await resp.json()) as S2Paper;
}

/** Backward citations (papers this one cites). */
export async function getReferences(
  paperId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<{ paper: S2Paper; isInfluential: boolean }[]> {
  const params = new URLSearchParams({
    limit: String(opts.limit ?? 100),
    offset: String(opts.offset ?? 0),
    fields: REFS_CITES_FIELDS,
  });
  const url = `${BASE}/paper/${encodeURIComponent(paperId)}/references?${params.toString()}`;
  const resp = await fetchWithRetry(url, { headers: headers() });
  if (!resp.ok) {
    throw new Error(`S2 getReferences(${paperId}) failed ${resp.status}: ${await resp.text()}`);
  }
  const json = (await resp.json()) as S2RefsCitesResp<{
    isInfluential: boolean;
    citedPaper: S2Paper;
  }>;
  return json.data
    .filter((d) => d.citedPaper?.paperId)
    .map((d) => ({ paper: d.citedPaper, isInfluential: !!d.isInfluential }));
}

/** Forward citations (papers citing this one). */
export async function getCitations(
  paperId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<{ paper: S2Paper; isInfluential: boolean }[]> {
  const params = new URLSearchParams({
    limit: String(opts.limit ?? 100),
    offset: String(opts.offset ?? 0),
    fields: REFS_CITES_FIELDS,
  });
  const url = `${BASE}/paper/${encodeURIComponent(paperId)}/citations?${params.toString()}`;
  const resp = await fetchWithRetry(url, { headers: headers() });
  if (!resp.ok) {
    throw new Error(`S2 getCitations(${paperId}) failed ${resp.status}: ${await resp.text()}`);
  }
  const json = (await resp.json()) as S2RefsCitesResp<{
    isInfluential: boolean;
    citingPaper: S2Paper;
  }>;
  return json.data
    .filter((d) => d.citingPaper?.paperId)
    .map((d) => ({ paper: d.citingPaper, isInfluential: !!d.isInfluential }));
}

/** Convenience: bulk fetch by identifier list. */
export async function batchGetPapers(ids: string[]): Promise<S2Paper[]> {
  if (ids.length === 0) return [];
  const url = `${BASE}/paper/batch?fields=${DEFAULT_FIELDS}`;
  const resp = await fetchWithRetry(url, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!resp.ok) {
    throw new Error(`S2 batchGetPapers failed ${resp.status}: ${await resp.text()}`);
  }
  const arr = (await resp.json()) as (S2Paper | null)[];
  return arr.filter((p): p is S2Paper => !!p);
}
