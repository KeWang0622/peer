/**
 * arXiv API client.
 * Docs: https://info.arxiv.org/help/api/user-manual.html
 *
 * Free, no auth, but rate-limit: 1 req / 3 sec (per their guidance).
 */
import { fetchWithRetry, sleep } from "../lib/retry.js";

const BASE = "https://export.arxiv.org/api/query";

export interface ArxivEntry {
  id: string;            // arxiv id like "2402.12345"
  url: string;           // abs page url
  title: string;
  summary: string;
  authors: string[];
  published: string;     // ISO
  updated: string;       // ISO
  categories: string[];
  primaryCategory: string;
  pdfUrl: string;
}

let lastRequest = 0;
const MIN_GAP_MS = 3100;

async function paced<T>(fn: () => Promise<T>): Promise<T> {
  const wait = Math.max(0, lastRequest + MIN_GAP_MS - Date.now());
  if (wait > 0) await sleep(wait);
  lastRequest = Date.now();
  return fn();
}

/**
 * Minimal Atom XML parser tuned for arXiv responses.
 * Avoids pulling in a full XML lib.
 */
function parseArxivAtom(xml: string): ArxivEntry[] {
  const entries: ArxivEntry[] = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let m: RegExpExecArray | null;
  while ((m = entryRegex.exec(xml)) !== null) {
    const block = m[1] ?? "";
    const idMatch = block.match(/<id>(.*?)<\/id>/);
    const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/);
    const summaryMatch = block.match(/<summary>([\s\S]*?)<\/summary>/);
    const publishedMatch = block.match(/<published>(.*?)<\/published>/);
    const updatedMatch = block.match(/<updated>(.*?)<\/updated>/);
    const primaryCatMatch = block.match(/<arxiv:primary_category[^>]+term="([^"]+)"/);
    const categoryMatches = [...block.matchAll(/<category[^>]+term="([^"]+)"/g)];
    const authorMatches = [...block.matchAll(/<author>\s*<name>(.*?)<\/name>/g)];
    const pdfMatch = block.match(/<link[^>]+title="pdf"[^>]+href="([^"]+)"/);

    const url = idMatch?.[1]?.trim() ?? "";
    const arxivId = url.replace(/^https?:\/\/arxiv\.org\/abs\//, "").replace(/v\d+$/, "");

    entries.push({
      id: arxivId,
      url,
      title: (titleMatch?.[1] ?? "").trim().replace(/\s+/g, " "),
      summary: (summaryMatch?.[1] ?? "").trim().replace(/\s+/g, " "),
      authors: authorMatches.map((a) => a[1] ?? "").filter(Boolean),
      published: publishedMatch?.[1] ?? "",
      updated: updatedMatch?.[1] ?? "",
      categories: categoryMatches.map((c) => c[1] ?? "").filter(Boolean),
      primaryCategory: primaryCatMatch?.[1] ?? "",
      pdfUrl: pdfMatch?.[1] ?? url.replace("/abs/", "/pdf/") + ".pdf",
    });
  }
  return entries;
}

export async function searchArxiv(
  query: string,
  opts: { maxResults?: number; sortBy?: "relevance" | "lastUpdatedDate" | "submittedDate" } = {},
): Promise<ArxivEntry[]> {
  const params = new URLSearchParams({
    search_query: query,
    start: "0",
    max_results: String(opts.maxResults ?? 20),
    sortBy: opts.sortBy ?? "relevance",
    sortOrder: "descending",
  });
  const url = `${BASE}?${params.toString()}`;
  return paced(async () => {
    const resp = await fetchWithRetry(url, {
      headers: { "User-Agent": "peer/0.0.1 (https://github.com/KeWang0622/peer)" },
    });
    if (!resp.ok) {
      throw new Error(`arXiv search failed ${resp.status}: ${await resp.text()}`);
    }
    return parseArxivAtom(await resp.text());
  });
}

export async function getArxivById(arxivId: string): Promise<ArxivEntry | undefined> {
  const cleaned = arxivId.replace(/^arxiv:/i, "").replace(/v\d+$/, "");
  const params = new URLSearchParams({
    id_list: cleaned,
    max_results: "1",
  });
  return paced(async () => {
    const resp = await fetchWithRetry(`${BASE}?${params.toString()}`, {
      headers: { "User-Agent": "peer/0.0.1 (https://github.com/KeWang0622/peer)" },
    });
    if (!resp.ok) {
      throw new Error(`arXiv getById(${cleaned}) failed ${resp.status}: ${await resp.text()}`);
    }
    const entries = parseArxivAtom(await resp.text());
    return entries[0];
  });
}

/** True if input matches "1234.56789" or "1234.5678" or "abs/..." style. */
export function isArxivId(s: string): boolean {
  const cleaned = s.replace(/^arxiv:/i, "").replace(/v\d+$/, "");
  return /^\d{4}\.\d{4,5}$/.test(cleaned) || /^[a-z\-]+\/\d{7}$/.test(cleaned);
}
