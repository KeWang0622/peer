/**
 * Google Scholar profile fetcher (best-effort, v0.0.1).
 *
 * Scholar has no public API. We do a crude HTML parse of the user's profile
 * page and pull as much as we can without rendering JS. If the structure
 * changes upstream this WILL go stale — that's why we surface the parsed
 * results to the caller and treat failure as non-fatal (the onboarding
 * flow falls back to the arxiv-IDs path).
 *
 * What we extract:
 *   - user display name (from <div id="gsc_prf_in">)
 *   - affiliation (from .gsc_prf_il, first row)
 *   - publication rows (.gsc_a_tr) — title, authors line, venue/year,
 *     cluster id (for deduping), citation count
 *
 * Scholar paginates publications via cstart/pagesize URL params. We pull up
 * to MAX_PUBLICATIONS papers across pages.
 *
 * The arxiv-IDs flow lives in src/algorithms/profile.ts which calls into
 * the existing arxiv client — there is no Scholar dependency for that path.
 */
import { fetchWithRetry } from "../lib/retry.js";

const SCHOLAR_HOST = "scholar.google.com";
const PAGE_SIZE = 100;
const MAX_PUBLICATIONS = 200;

export interface ScholarPublication {
  /** Scholar cluster id (stable across versions of the same paper). */
  clusterId: string | null;
  /** Title as displayed on the profile. */
  title: string;
  /** Comma-separated author line as Scholar returns it. */
  authors: string;
  /** Venue / journal / conference line. */
  venue: string;
  /** Year as an integer, if Scholar exposes one. */
  year: number | null;
  /** Citation count, as Scholar reports it. */
  citationCount: number | null;
}

export interface ScholarProfile {
  /** Scholar user id, parsed from the URL. */
  userId: string;
  /** Profile display name. */
  name: string | null;
  /** Affiliation line. */
  affiliation: string | null;
  /** Publications, newest first (Scholar's default sort). */
  publications: ScholarPublication[];
}

/**
 * Pulled-out user-id parser for testability.
 * Returns the `user` query param from a recognised Scholar URL, or null.
 */
export function parseScholarUserId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Accept bare user-ids too: 12 chars of [A-Za-z0-9_-].
  if (/^[A-Za-z0-9_-]{8,16}$/.test(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);
    if (!url.hostname.toLowerCase().endsWith(SCHOLAR_HOST)) return null;
    const user = url.searchParams.get("user");
    if (user && /^[A-Za-z0-9_-]{6,20}$/.test(user)) return user;
    return null;
  } catch {
    return null;
  }
}

/**
 * True if the input looks like a Scholar profile URL or bare user id.
 */
export function isScholarUrl(input: string): boolean {
  return parseScholarUserId(input) !== null;
}

/**
 * Fetch a Google Scholar profile and parse out publications.
 *
 * Throws if the profile cannot be fetched or no user id can be parsed.
 * Returns a profile with publications: [] if HTML parsed but no rows matched
 * (likely structural drift — caller should fall back to arxiv-IDs).
 */
export async function fetchScholarProfile(input: string): Promise<ScholarProfile> {
  const userId = parseScholarUserId(input);
  if (!userId) {
    throw new Error(
      `Not a Google Scholar profile URL: "${input}". ` +
        `Expected scholar.google.com/citations?user=<id>`,
    );
  }

  const publications: ScholarPublication[] = [];
  let name: string | null = null;
  let affiliation: string | null = null;

  for (let cstart = 0; cstart < MAX_PUBLICATIONS; cstart += PAGE_SIZE) {
    const url =
      `https://${SCHOLAR_HOST}/citations` +
      `?user=${encodeURIComponent(userId)}` +
      `&cstart=${cstart}` +
      `&pagesize=${PAGE_SIZE}` +
      `&hl=en`;

    const resp = await fetchWithRetry(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64) prof/0.0.1 (+https://github.com/kewang/prof)",
          Accept: "text/html,application/xhtml+xml",
        },
      },
      { retries: 2, timeoutMs: 15_000 },
    );
    if (!resp.ok) {
      // 429 / 403 → Scholar blocked us. Surface a clean error so the caller can fall back.
      throw new Error(
        `Google Scholar returned HTTP ${resp.status} for user ${userId}. ` +
          `Scholar throttles automated requests — try the arxiv-IDs path instead.`,
      );
    }
    const html = await resp.text();

    if (name === null) name = extractName(html);
    if (affiliation === null) affiliation = extractAffiliation(html);

    const pubs = extractPublications(html);
    publications.push(...pubs);

    // Stop if Scholar gave us fewer rows than a full page — there are no more.
    if (pubs.length < PAGE_SIZE) break;
  }

  return { userId, name, affiliation, publications: publications.slice(0, MAX_PUBLICATIONS) };
}

// ============================================================
// HTML parsers (best-effort regex; tolerant of attribute reordering)
// ============================================================

function extractName(html: string): string | null {
  const m = html.match(/<div[^>]*id="gsc_prf_in"[^>]*>([\s\S]*?)<\/div>/i);
  return m?.[1] ? cleanText(m[1]) : null;
}

function extractAffiliation(html: string): string | null {
  // First .gsc_prf_il under #gsc_prf is the affiliation line.
  const m = html.match(/<div[^>]*class="gsc_prf_il"[^>]*>([\s\S]*?)<\/div>/i);
  return m?.[1] ? cleanText(m[1]) : null;
}

/** Pull all <tr class="gsc_a_tr"> rows and parse each one. */
function extractPublications(html: string): ScholarPublication[] {
  const rows: ScholarPublication[] = [];
  const rowRe = /<tr[^>]*class="gsc_a_tr"[^>]*>([\s\S]*?)<\/tr>/g;
  let match: RegExpExecArray | null;
  while ((match = rowRe.exec(html)) !== null) {
    const row = match[1] ?? "";
    const pub = parseRow(row);
    if (pub) rows.push(pub);
  }
  return rows;
}

function parseRow(row: string): ScholarPublication | null {
  // Title cell: <a class="gsc_a_at" href="?...citation_for_view=USER:CLUSTER">TITLE</a>
  const titleMatch =
    row.match(/<a[^>]*class="gsc_a_at"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i) ?? null;
  if (!titleMatch) return null;
  const titleHref = titleMatch[1] ?? "";
  const title = cleanText(titleMatch[2] ?? "");
  if (!title) return null;

  // The cluster id is the part after the colon in citation_for_view.
  // Example: citation_for_view=AbC123:dEf456
  let clusterId: string | null = null;
  const cfv = titleHref.match(/citation_for_view=[^:&]+:([^&]+)/);
  if (cfv?.[1]) clusterId = cfv[1];

  // Two .gs_gray spans inside the title cell: first is authors, second is venue+year (sometimes).
  const grayMatches = [...row.matchAll(/<div[^>]*class="gs_gray"[^>]*>([\s\S]*?)<\/div>/g)];
  const authors = grayMatches[0]?.[1] ? cleanText(grayMatches[0][1]) : "";
  const venueRaw = grayMatches[1]?.[1] ? cleanText(grayMatches[1][1]) : "";

  // Year cell: <td class="gsc_a_y"><span class="gsc_a_h">YEAR</span></td>
  const yearMatch = row.match(/<span[^>]*class="gsc_a_h[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
  const yearText = yearMatch?.[1] ? cleanText(yearMatch[1]) : "";
  const year = /^\d{4}$/.test(yearText) ? parseInt(yearText, 10) : null;

  // Citation count cell: <a class="gsc_a_ac ...">N</a>  — may be empty if 0.
  const citeMatch = row.match(/<a[^>]*class="gsc_a_ac[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
  const citeText = citeMatch?.[1] ? cleanText(citeMatch[1]) : "";
  const citationCount = /^\d+$/.test(citeText) ? parseInt(citeText, 10) : 0;

  return {
    clusterId,
    title,
    authors,
    venue: venueRaw,
    year,
    citationCount,
  };
}

function cleanText(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
