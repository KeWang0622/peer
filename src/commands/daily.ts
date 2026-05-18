/**
 * `prof daily` - rank fresh arXiv RSS papers against the user's library.
 */
import * as fs from "node:fs";
import { fetchArxivRss, type ArxivRssEntry } from "../api/arxiv-rss.js";
import { paths, ensureDirs } from "../config/paths.js";
import { db, type PaperRow } from "../db/client.js";
import { complete, embed, MODELS, totalCostUsd } from "../lib/llm.js";

const DEFAULT_CATEGORIES = ["cs.AI", "cs.LG", "cs.CL"];
const DAY_MS = 24 * 60 * 60 * 1000;

interface UserProfile {
  exists: boolean;
  raw: string;
  subfields: string[];
  primarySubfield: string | null;
  keywords: string[];
}

interface RankedPaper {
  entry: ArxivRssEntry;
  similarity: number;
  why?: string;
}

export async function cmdDaily(opts: { verbose?: boolean } = {}): Promise<void> {
  ensureDirs();
  const t0 = Date.now();
  const costBefore = totalCostUsd();
  const profile = readUserProfile();
  const categories = categoriesForProfile(profile);
  const log = (msg: string) => {
    if (opts.verbose) console.log(`  - ${msg}`);
  };

  console.log("\nprof daily\n");
  console.log(`Categories: ${categories.join(", ")}`);

  log("fetching arXiv RSS feeds");
  const entries = dedupeEntries((await Promise.all(categories.map((category) => fetchArxivRss(category)))).flat());
  const candidates = entries
    .filter((entry) => isWithinLastDay(entry))
    .sort((a, b) => entryTimeMs(b) - entryTimeMs(a));

  if (candidates.length === 0) {
    console.log("\nNo arXiv RSS papers found from the last 24 hours for these categories.");
    printCostSummary(Date.now() - t0, costBefore);
    return;
  }

  log(`${candidates.length} fresh candidates after dedupe and 24h filter`);
  const references = referenceTexts(profile);
  if (references.length === 0) {
    console.log("\nNo ranking context found. Add papers with `prof read` or add keywords to ~/.prof/profile.md.");
    printCostSummary(Date.now() - t0, costBefore);
    return;
  }

  log(`embedding ${references.length} references + ${candidates.length} candidates`);
  const top = await rankByMaxSimilarity(candidates, references);

  if (profile.exists) {
    await addWhyThisMatches(top, profile, log);
  }

  console.log("\nTop papers:\n");
  for (const [i, paper] of top.entries()) {
    printPaper(i + 1, paper);
  }

  printCostSummary(Date.now() - t0, costBefore);
}

function readUserProfile(): UserProfile {
  const raw = fs.existsSync(paths.profile()) ? fs.readFileSync(paths.profile(), "utf-8") : "";
  const frontmatter = extractFrontmatter(raw);
  const parsed = parseFrontmatter(frontmatter);
  const subfields = normalizeCategories(parsed.subfields);
  const primarySubfield = normalizeCategories([parsed.primary_subfield ?? parsed.primarySubfield ?? ""])[0] ?? null;
  const keywords = normalizeStrings([
    ...asArray(parsed.topic_keywords),
    ...asArray(parsed.keywords),
    ...asArray(parsed.interests),
    ...asArray(parsed.research_interests),
    ...asArray(parsed.topics),
  ]);

  return {
    exists: raw.length > 0,
    raw,
    subfields: subfields.length > 0 ? subfields : DEFAULT_CATEGORIES,
    primarySubfield,
    keywords,
  };
}

function categoriesForProfile(profile: UserProfile): string[] {
  const categories = normalizeCategories([
    ...(profile.primarySubfield ? [profile.primarySubfield] : []),
    ...profile.subfields,
  ]);
  return categories.length > 0 ? categories : DEFAULT_CATEGORIES;
}

function extractFrontmatter(markdown: string): string {
  const match = markdown.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\s*\r?\n|$)/);
  return match?.[1] ?? "";
}

function parseFrontmatter(frontmatter: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const lines = frontmatter.split(/\r?\n/);
  let currentListKey: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const listItem = trimmed.match(/^-\s+(.+)$/);
    if (listItem && currentListKey) {
      const current = out[currentListKey];
      const values = Array.isArray(current) ? current : [];
      values.push(cleanYamlValue(listItem[1] ?? ""));
      out[currentListKey] = values;
      continue;
    }

    const keyValue = trimmed.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!keyValue) {
      currentListKey = null;
      continue;
    }

    const key = keyValue[1] ?? "";
    const value = keyValue[2] ?? "";
    if (value === "") {
      out[key] = [];
      currentListKey = key;
    } else {
      out[key] = parseYamlValue(value);
      currentListKey = null;
    }
  }

  return out;
}

function parseYamlValue(value: string): string | string[] {
  const trimmed = value.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map(cleanYamlValue)
      .filter(Boolean);
  }
  return cleanYamlValue(trimmed);
}

function cleanYamlValue(value: string): string {
  return value
    .trim()
    .replace(/\s+#.*$/, "")
    .replace(/^['"]|['"]$/g, "")
    .trim();
}

function asArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (typeof value === "string" && value.trim()) return value.split(",").map((item) => item.trim());
  return [];
}

function normalizeCategories(value: unknown): string[] {
  return unique(
    asArray(value)
      .map((item) => item.trim())
      .filter((item) => /^[a-z-]+(?:\.[A-Z]{2})?$/.test(item)),
  );
}

function normalizeStrings(values: string[]): string[] {
  return unique(values.map((value) => value.trim()).filter(Boolean));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function referenceTexts(profile: UserProfile): string[] {
  const recent = db()
    .prepare<[], Pick<PaperRow, "title" | "abstract">>(
      "SELECT title, abstract FROM papers ORDER BY ingested_at DESC LIMIT 10",
    )
    .all();

  if (recent.length > 0) {
    return recent.map((paper) => paperText(paper.title, paper.abstract ?? ""));
  }

  if (profile.exists && profile.keywords.length > 0) {
    return profile.keywords;
  }

  return defaultKeywords(categoriesForProfile(profile));
}

function defaultKeywords(categories: string[]): string[] {
  const labels: Record<string, string> = {
    "cs.AI": "artificial intelligence",
    "cs.LG": "machine learning",
    "cs.CL": "natural language processing computational linguistics",
  };
  return categories.map((category) => labels[category] ?? category);
}

function dedupeEntries(entries: ArxivRssEntry[]): ArxivRssEntry[] {
  const seen = new Set<string>();
  const out: ArxivRssEntry[] = [];
  for (const entry of entries) {
    const key = entry.id || entry.url || entry.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

function isWithinLastDay(entry: ArxivRssEntry): boolean {
  const ms = entryTimeMs(entry);
  if (!Number.isFinite(ms) || ms <= 0) return false;
  return Date.now() - ms <= DAY_MS && ms <= Date.now() + 60_000;
}

function entryTimeMs(entry: ArxivRssEntry): number {
  const ms = Date.parse(entry.updated || entry.published);
  return Number.isFinite(ms) ? ms : 0;
}

async function rankByMaxSimilarity(candidates: ArxivRssEntry[], references: string[]): Promise<RankedPaper[]> {
  const candidateTexts = candidates.map((paper) => paperText(paper.title, paper.summary));
  const { vectors } = await embed([...references, ...candidateTexts]);
  const referenceVectors = vectors.slice(0, references.length);
  const candidateVectors = vectors.slice(references.length);

  return candidates
    .map((entry, idx) => ({
      entry,
      similarity: Math.max(...referenceVectors.map((ref) => cosine(ref, candidateVectors[idx] ?? []))),
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 3);
}

function paperText(title: string, abstract: string): string {
  return `${title}\n\n${abstract}`.replace(/\s+/g, " ").trim().slice(0, 4000);
}

function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function addWhyThisMatches(
  papers: RankedPaper[],
  profile: UserProfile,
  log: (msg: string) => void,
): Promise<void> {
  await Promise.all(
    papers.map(async (paper) => {
      try {
        const { text } = await complete({
          model: MODELS.cheap,
          system: "You explain paper recommendations in one concise sentence. No preamble.",
          prompt: whyPrompt(paper.entry, profile),
          maxTokens: 80,
          temperature: 0.2,
        });
        paper.why = firstSentence(text);
      } catch (err) {
        log(`why skipped: ${(err as Error).message}`);
      }
    }),
  );
}

function whyPrompt(entry: ArxivRssEntry, profile: UserProfile): string {
  const profileContext = extractFrontmatter(profile.raw) || profile.raw.slice(0, 1200);
  return `User profile:
${profileContext}

Recommended paper:
Title: ${entry.title}
Authors: ${entry.authors.slice(0, 3).join(", ")}
Abstract: ${entry.summary.slice(0, 1200)}

In one sentence, explain why this paper matches the user's research interests.`;
}

function firstSentence(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const match = cleaned.match(/^(.+?[.!?])(?:\s|$)/);
  return (match?.[1] ?? cleaned).slice(0, 300);
}

function printPaper(index: number, paper: RankedPaper): void {
  const authors = paper.entry.authors.length > 0 ? paper.entry.authors.slice(0, 3).join(", ") : "Unknown authors";

  console.log(`${index}. ${paper.entry.title}`);
  console.log(`   Authors: ${authors}`);
  console.log(`   Abstract: ${excerpt(paper.entry.summary, 200)}`);
  console.log(`   arXiv URL: ${paper.entry.url}`);
  console.log(`   Similarity: ${paper.similarity.toFixed(3)}`);
  console.log(`   Link: ${pdfUrl(paper.entry.url)}`);
  if (paper.why) {
    console.log(`   Why this matches: ${paper.why}`);
  }
  console.log("");
}

function pdfUrl(url: string): string {
  return url.includes("/abs/") ? url.replace("/abs/", "/pdf/") : url;
}

function excerpt(text: string, maxChars: number): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxChars) return cleaned;
  return `${cleaned.slice(0, maxChars).trimEnd()}...`;
}

function printCostSummary(elapsedMs: number, costBefore: number): void {
  console.log(`Cost: $${(totalCostUsd() - costBefore).toFixed(4)}`);
  console.log(`Elapsed: ${(elapsedMs / 1000).toFixed(1)}s\n`);
}
