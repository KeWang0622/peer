/**
 * arXiv RSS client.
 *
 * RSS endpoint shape is intentionally parsed with small regex helpers to match
 * the existing arxiv.ts client style and avoid adding an XML dependency.
 */
import { fetchWithRetry } from "../lib/retry.js";

const BASE = "https://rss.arxiv.org/rss";
const USER_AGENT = "peer/0.0.1 (https://github.com/KeWang0622/peer)";

export interface ArxivRssEntry {
  id: string;
  url: string;
  title: string;
  summary: string;
  authors: string[];
  published: string;
  updated: string;
  categories: string[];
  primaryCategory: string;
}

export async function fetchArxivRss(category: string): Promise<ArxivRssEntry[]> {
  const cleaned = cleanCategory(category);
  const resp = await fetchWithRetry(`${BASE}/${encodeURIComponent(cleaned)}`, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!resp.ok) {
    throw new Error(`arXiv RSS ${cleaned} failed ${resp.status}: ${await resp.text()}`);
  }
  return parseArxivRss(await resp.text(), cleaned);
}

export function parseArxivRss(xml: string, category = ""): ArxivRssEntry[] {
  const entries: ArxivRssEntry[] = [];
  const itemRegex = /<item\b[^>]*>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRegex.exec(xml)) !== null) {
    const block = m[1] ?? "";
    const rawLink = firstTag(block, "link");
    const url = normalizeArxivUrl(rawLink);
    const id = arxivIdFromUrl(url);
    if (!id || !url) continue;

    const description = cleanText(firstTag(block, "description"));
    const authors = extractAuthors(block, description);
    const summary = extractAbstract(description);
    const published = normalizeDate(
      firstTag(block, "pubDate") || firstTag(block, "dc:date") || firstTag(block, "published"),
    );
    const updated = normalizeDate(firstTag(block, "updated")) || published;
    const categories = extractCategories(block, category);

    entries.push({
      id,
      url,
      title: cleanText(firstTag(block, "title")),
      summary,
      authors,
      published,
      updated,
      categories,
      primaryCategory: categories[0] ?? category,
    });
  }
  return entries;
}

function cleanCategory(category: string): string {
  return category.trim().replace(/^https?:\/\/rss\.arxiv\.org\/rss\//, "");
}

function firstTag(block: string, tag: string): string {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  return decodeXml(match?.[1] ?? "").trim();
}

function extractCategories(block: string, fallback: string): string[] {
  const categories = [...block.matchAll(/<category\b[^>]*>([\s\S]*?)<\/category>/gi)]
    .map((m) => cleanText(decodeXml(m[1] ?? "")))
    .filter(Boolean);

  const termCategories = [...block.matchAll(/<category\b[^>]*term="([^"]+)"/gi)]
    .map((m) => cleanText(decodeXml(m[1] ?? "")))
    .filter(Boolean);

  const all = [...categories, ...termCategories, fallback].filter(Boolean);
  return [...new Set(all)];
}

function extractAuthors(block: string, description: string): string[] {
  const creators = [...block.matchAll(/<dc:creator\b[^>]*>([\s\S]*?)<\/dc:creator>/gi)]
    .map((m) => cleanText(decodeXml(m[1] ?? "")))
    .filter(Boolean);
  if (creators.length > 0) return creators;

  const authorMatch = description.match(/^Authors?:\s*([\s\S]*?)(?:\n\s*\n|Abstract:|$)/i);
  const raw = authorMatch?.[1]?.trim() ?? "";
  if (!raw) return [];

  return raw
    .replace(/\s+and\s+/gi, ", ")
    .split(/\s*,\s*|\s*;\s*/)
    .map((a) => a.trim())
    .filter(Boolean);
}

function extractAbstract(description: string): string {
  const withoutAuthors = description.replace(/^Authors?:\s*[\s\S]*?(?:\n\s*\n|(?=Abstract:))/i, "");
  return withoutAuthors.replace(/^Abstract:\s*/i, "").trim();
}

function normalizeArxivUrl(raw: string): string {
  return raw
    .trim()
    .replace(/^http:\/\//, "https://")
    .replace(/\/pdf\//, "/abs/")
    .replace(/\.pdf$/i, "");
}

function arxivIdFromUrl(url: string): string {
  return url
    .replace(/^https?:\/\/arxiv\.org\/abs\//, "")
    .replace(/[?#].*$/, "")
    .replace(/v\d+$/, "")
    .trim();
}

function normalizeDate(value: string): string {
  if (!value) return "";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toISOString();
}

function cleanText(value: string): string {
  return stripTags(value).replace(/\s+/g, " ").trim();
}

function stripTags(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "");
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
