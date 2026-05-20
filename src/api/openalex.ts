/**
 * OpenAlex API client — free fallback for Semantic Scholar.
 * Docs: https://docs.openalex.org/
 *
 * No auth needed. Polite pool: include your email in `mailto` for higher rate limits.
 * 100k requests/day at 10 req/sec is typical.
 */
import { fetchWithRetry } from "../lib/retry.js";

const BASE = "https://api.openalex.org";

function ua(): string {
  const email = process.env.OPENALEX_EMAIL ?? "peer-cli@example.com";
  return `peer/0.0.1 (https://github.com/KeWang0622/peer; mailto:${email})`;
}

function commonParams(): URLSearchParams {
  const p = new URLSearchParams();
  const email = process.env.OPENALEX_EMAIL;
  if (email) p.set("mailto", email);
  return p;
}

export interface OAAuthorship {
  author: {
    id: string | null;
    display_name: string;
    orcid?: string | null;
  };
  author_position: "first" | "middle" | "last";
  institutions?: Array<{ id: string; display_name: string }>;
}

export interface OAWork {
  id: string;                       // OpenAlex work id (full URL)
  doi: string | null;               // e.g. "https://doi.org/10.0/foo"
  title: string;
  display_name?: string;
  abstract_inverted_index?: Record<string, number[]> | null;
  publication_year: number | null;
  cited_by_count: number;
  authorships: OAAuthorship[];
  primary_location?: {
    source?: { display_name?: string; type?: string; issn_l?: string };
  };
  open_access?: { is_oa: boolean; oa_url?: string | null };
  ids?: {
    openalex?: string;
    doi?: string;
    mag?: string;
    pmid?: string;
    arxiv_id?: string;
  };
}

/** OpenAlex returns abstracts as an inverted index. Reconstruct a single string. */
export function abstractFromInvertedIndex(idx?: Record<string, number[]> | null): string | null {
  if (!idx) return null;
  const positions: Array<[number, string]> = [];
  for (const [word, posList] of Object.entries(idx)) {
    for (const p of posList) positions.push([p, word]);
  }
  positions.sort((a, b) => a[0] - b[0]);
  return positions.map(([, w]) => w).join(" ");
}

/** Lift arxiv id from OpenAlex ids object (best-effort). */
export function arxivIdFromOA(work: OAWork): string | null {
  const direct = work.ids?.arxiv_id;
  if (direct) return direct;
  // Sometimes encoded inside doi (rare). Skip best-effort heuristics for now.
  return null;
}

/** Lift cleaned DOI string from OpenAlex work (strips the URL prefix). */
export function doiFromOA(work: OAWork): string | null {
  const raw = work.doi ?? work.ids?.doi ?? null;
  if (!raw) return null;
  return raw.replace(/^https?:\/\/doi\.org\//i, "");
}

export interface OASearchResp {
  meta: { count: number; page: number; per_page: number };
  results: OAWork[];
}

export async function searchWorks(
  query: string,
  opts: { perPage?: number; page?: number; minYear?: number } = {},
): Promise<OASearchResp> {
  const params = commonParams();
  params.set("search", query);
  params.set("per-page", String(opts.perPage ?? 25));
  params.set("page", String(opts.page ?? 1));
  params.set("sort", "relevance_score:desc");
  if (opts.minYear) params.set("filter", `from_publication_date:${opts.minYear}-01-01`);

  const url = `${BASE}/works?${params.toString()}`;
  const resp = await fetchWithRetry(url, {
    headers: { "User-Agent": ua(), Accept: "application/json" },
  });
  if (!resp.ok) {
    throw new Error(`OpenAlex search failed ${resp.status}: ${await resp.text()}`);
  }
  return (await resp.json()) as OASearchResp;
}

export async function getWork(id: string): Promise<OAWork> {
  // Accept full URL or just W-id or DOI
  let ref = id.trim();
  if (/^10\.\d{4,9}\//.test(ref)) ref = `https://doi.org/${ref}`;
  if (!/^https?:\/\//.test(ref) && !ref.startsWith("W")) {
    ref = `https://doi.org/${ref}`;
  }
  const url = `${BASE}/works/${encodeURIComponent(ref)}?${commonParams().toString()}`;
  const resp = await fetchWithRetry(url, {
    headers: { "User-Agent": ua(), Accept: "application/json" },
  });
  if (!resp.ok) {
    throw new Error(`OpenAlex getWork(${id}) failed ${resp.status}: ${await resp.text()}`);
  }
  return (await resp.json()) as OAWork;
}
