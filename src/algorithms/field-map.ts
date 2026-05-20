/**
 * `peer map <topic>` — the field-mapping pipeline.
 *
 * Pipeline:
 *   1. seed search via S2 → top N papers
 *   2. embed abstracts via OpenAI
 *   3. cluster (agglomerative, fixed k from suggestedK)
 *   4. per cluster: find centroid paper, identify frontier (most recent high-cite)
 *   5. find survey/review papers
 *   6. LLM narrative generation
 *
 * Output: ~/.peer/notes/fields/<slug>/{overview.md, reading-order.md, subfields.md}
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { paths, ensureDirs } from "../config/paths.js";
import * as s2 from "../api/semantic-scholar.js";
import * as oa from "../api/openalex.js";
import { embed, complete, MODELS } from "../lib/llm.js";
import { cluster, clusterCentroidMember, suggestedK } from "./cluster.js";
import { upsertPaper, paperCanonicalId } from "../db/client.js";

export interface FieldMapResult {
  fieldSlug: string;
  outputDir: string;
  paperCount: number;
  clusterCount: number;
  cost: number;
}

export interface ProgressCallback {
  (step: string, detail?: string): void;
}

export async function profMap(
  topic: string,
  opts: {
    limit?: number;
    onProgress?: ProgressCallback;
  } = {},
): Promise<FieldMapResult> {
  ensureDirs();

  const onProgress = opts.onProgress ?? (() => {});
  const slug = topicSlug(topic);
  const outputDir = path.join(paths.fieldsNotes(), slug);
  fs.mkdirSync(outputDir, { recursive: true });

  // ---- Step 1: seed search (S2 → OpenAlex fallback on rate-limit/failure) ----
  const limit = opts.limit ?? 100;
  let seedPapers: s2.S2Paper[] = [];
  try {
    onProgress("searching", "Semantic Scholar");
    const seedSearch = await s2.searchPapers(topic, { limit: Math.min(limit, 100) });
    seedPapers = seedSearch.data.filter((p) => p.abstract && p.abstract.length > 100);
  } catch (err) {
    const msg = (err as Error).message;
    onProgress("s2-failed", `${msg.slice(0, 80)} — falling back to OpenAlex`);
  }

  if (seedPapers.length < 5) {
    onProgress("searching", "OpenAlex (fallback)");
    const oaResp = await oa.searchWorks(topic, { perPage: Math.min(limit, 50) });
    // Convert OpenAlex works → minimal S2Paper shape so the rest of the pipeline doesn't change
    seedPapers = oaResp.results
      .map((w): s2.S2Paper => ({
        paperId: w.id.replace(/^https?:\/\/openalex\.org\//, "oa-"),
        externalIds: {
          DOI: oa.doiFromOA(w) ?? undefined,
          ArXiv: oa.arxivIdFromOA(w) ?? undefined,
        },
        title: w.title ?? w.display_name ?? "(untitled)",
        abstract: oa.abstractFromInvertedIndex(w.abstract_inverted_index) ?? null,
        year: w.publication_year ?? null,
        venue: w.primary_location?.source?.display_name ?? null,
        citationCount: w.cited_by_count ?? 0,
        referenceCount: 0,
        authors: (w.authorships ?? []).map((a) => ({
          authorId: a.author.id ?? null,
          name: a.author.display_name,
        })),
      }))
      .filter((p) => p.abstract && p.abstract.length > 100);
  }

  if (seedPapers.length < 5) {
    throw new Error(`Too few papers found for "${topic}" (got ${seedPapers.length}). Try a broader query.`);
  }

  onProgress("seeded", `${seedPapers.length} papers`);

  // Also fetch survey-flavored papers (heuristic)
  onProgress("surveys", "Searching for surveys");
  let surveys: s2.S2Paper[] = [];
  try {
    const surveySearch = await s2.searchPapers(`${topic} survey`, { limit: 10 });
    surveys = surveySearch.data
      .filter((p) => p.abstract)
      .filter((p) => /survey|review/i.test(p.title))
      .slice(0, 5);
  } catch {
    /* non-fatal */
  }

  // ---- Step 2: embed ----
  onProgress("embedding", `${seedPapers.length} abstracts`);
  const texts = seedPapers.map((p) => `${p.title}\n\n${p.abstract}`);
  const { vectors, cost: embedCost } = await embed(texts);

  // ---- Step 3: cluster ----
  const k = suggestedK(seedPapers.length);
  onProgress("clustering", `into ${k} subfields`);
  const labels = cluster(vectors, k);

  // ---- Step 4: per-cluster analysis ----
  onProgress("analyzing", "Identifying subfields and frontiers");
  const subfields: Subfield[] = [];
  for (let c = 0; c < k; c++) {
    const members = seedPapers.filter((_, i) => labels[i] === c);
    if (members.length === 0) continue;

    const centroidIdx = clusterCentroidMember(vectors, labels, c);
    const centroidPaper = centroidIdx >= 0 ? seedPapers[centroidIdx] : undefined;

    // Sort members by year+citations for "frontier"
    const byRecency = [...members].sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
    const byImpact = [...members].sort((a, b) => (b.citationCount ?? 0) - (a.citationCount ?? 0));

    subfields.push({
      label: `subfield-${c + 1}`,
      papers: members,
      centroid: centroidPaper,
      foundational: byImpact.slice(0, 3),
      frontier: byRecency.slice(0, 3),
    });
  }

  // Name the clusters using LLM
  onProgress("naming", "Asking model to name subareas");
  const namedSubfields = await nameSubfields(topic, subfields);

  // ---- Step 5: narrative generation ----
  onProgress("writing", "Generating field overview narrative");
  const { text: narrative, cost: narrativeCost } = await generateNarrative(topic, namedSubfields, surveys);

  // Open problems pass
  onProgress("problems", "Identifying open problems");
  const { text: openProblems, cost: opCost } = await generateOpenProblems(topic, namedSubfields);

  // ---- Step 6: write files ----
  onProgress("saving", outputDir);
  fs.writeFileSync(path.join(outputDir, "overview.md"), narrative);
  fs.writeFileSync(path.join(outputDir, "reading-order.md"), generateReadingOrder(topic, namedSubfields, surveys));
  fs.writeFileSync(path.join(outputDir, "subfields.md"), generateSubfieldsDoc(topic, namedSubfields));
  fs.writeFileSync(path.join(outputDir, "open-problems.md"), openProblems);
  fs.writeFileSync(path.join(outputDir, "papers.json"), JSON.stringify({ topic, generated_at: new Date().toISOString(), subfields: namedSubfields }, null, 2));

  // Persist all seen papers to L1
  for (const p of seedPapers) {
    if (!p.title) continue;
    upsertPaper({
      id: paperCanonicalId({
        arxiv_id: p.externalIds?.ArXiv ?? null,
        doi: p.externalIds?.DOI ?? null,
        s2_id: p.paperId,
        title: p.title,
        year: p.year ?? null,
      }),
      s2_id: p.paperId,
      doi: p.externalIds?.DOI ?? null,
      arxiv_id: p.externalIds?.ArXiv ?? null,
      title: p.title,
      abstract: p.abstract ?? null,
      year: p.year ?? null,
      venue: p.venue ?? null,
      citations_count: p.citationCount ?? 0,
      references_count: p.referenceCount ?? 0,
      pdf_path: null,
      source: "semantic-scholar",
      raw_json: JSON.stringify(p),
    });
  }

  const totalCost = embedCost.costUsd + narrativeCost.costUsd + opCost.costUsd;

  return {
    fieldSlug: slug,
    outputDir,
    paperCount: seedPapers.length,
    clusterCount: namedSubfields.length,
    cost: totalCost,
  };
}

// ============================================================
// Subfield naming + narrative
// ============================================================

interface Subfield {
  label: string;
  papers: s2.S2Paper[];
  centroid: s2.S2Paper | undefined;
  foundational: s2.S2Paper[];
  frontier: s2.S2Paper[];
}

async function nameSubfields(topic: string, subfields: Subfield[]): Promise<Subfield[]> {
  const blocks = subfields.map(
    (s, i) =>
      `Cluster ${i + 1} (${s.papers.length} papers):\n` +
      s.papers
        .slice(0, 6)
        .map((p) => `- ${p.title} (${p.year ?? "?"})`)
        .join("\n"),
  );

  const { text } = await complete({
    model: MODELS.cheap,
    system: "You name subareas of an academic field. Output JSON only.",
    prompt: `Topic: "${topic}"

Below are clusters of papers (already grouped by semantic similarity). Give each cluster a short specific name (4-8 words) that describes what unites those papers.

${blocks.join("\n\n")}

Output ONLY a JSON array of strings, one name per cluster, in order:
["...", "...", ...]`,
    maxTokens: 800,
    temperature: 0.3,
  });

  let names: string[] = [];
  try {
    const m = text.match(/\[[\s\S]*\]/);
    if (m) names = JSON.parse(m[0]);
  } catch {
    /* fall through */
  }

  return subfields.map((s, i) => ({
    ...s,
    label: names[i] ?? s.label,
  }));
}

async function generateNarrative(topic: string, subfields: Subfield[], surveys: s2.S2Paper[]) {
  const subfieldBriefs = subfields
    .map(
      (s) =>
        `### ${s.label} (${s.papers.length} papers)
Centroid: ${s.centroid?.title ?? "?"} (${s.centroid?.year ?? "?"})
Most cited:
${s.foundational
  .slice(0, 3)
  .map((p) => `- ${p.title} (${p.year ?? "?"}, ${p.citationCount ?? 0} cites)`)
  .join("\n")}
Recent:
${s.frontier
  .slice(0, 3)
  .map((p) => `- ${p.title} (${p.year ?? "?"})`)
  .join("\n")}`,
    )
    .join("\n\n");

  const surveyBlock =
    surveys.length > 0
      ? `\n\nKnown surveys / reviews:\n${surveys.map((s) => `- ${s.title} (${s.year ?? "?"})`).join("\n")}`
      : "";

  const prompt = `You are writing a field overview for a researcher new to "${topic}".

I have already clustered the literature into the following subareas:

${subfieldBriefs}${surveyBlock}

Write a 1500-2000 word overview in Obsidian-compatible markdown. Structure:

# ${topic} — Field Overview

A 2-paragraph orientation: what this field is, why it matters, the current state.

## Subareas

One subsection per subarea above (use the names given). For each:
- What questions this subarea asks
- The 2-3 key insights from the foundational papers
- Where the frontier is

## How to read into this field

Concrete reading order in 3 tiers: foundation (3-5 papers), core (5-10 papers), frontier (3-5 papers).
Use the actual paper titles I gave you. Wikilink format: [[Paper Title (Year)]].

## What to watch

3-5 emerging directions in the last 12 months.

## Open questions

The 3-5 most important unresolved problems.

Be specific. Cite real papers from my list. Do NOT invent papers.`;

  return await complete({
    model: MODELS.smart,
    system: "You write field overviews for academic researchers. Be specific, cite only papers given, use markdown.",
    prompt,
    maxTokens: 4096,
    temperature: 0.4,
  });
}

async function generateOpenProblems(topic: string, subfields: Subfield[]) {
  const titlesByCluster = subfields
    .map((s) => `## ${s.label}\n${s.papers.slice(0, 8).map((p) => `- ${p.title}`).join("\n")}`)
    .join("\n\n");

  const prompt = `Topic: "${topic}"

Across these subareas of papers, what are the 5 most important open / unresolved problems?

${titlesByCluster}

For each, write 2-3 sentences: what the problem is, why it matters, what would constitute progress.

Output as markdown:

# Open problems in ${topic}

## 1. <problem name>
<2-3 sentences>

## 2. ...

Be specific. Ground each in the actual literature themes above.`;

  return await complete({
    model: MODELS.smart,
    system: "You identify research gaps. Be specific. No vague generalities.",
    prompt,
    maxTokens: 2048,
    temperature: 0.5,
  });
}

function generateReadingOrder(topic: string, subfields: Subfield[], surveys: s2.S2Paper[]): string {
  const foundation = subfields.flatMap((s) => s.foundational.slice(0, 1));
  const core = subfields.flatMap((s) => s.foundational.slice(1, 3));
  const frontier = subfields.flatMap((s) => s.frontier.slice(0, 2));

  const fmt = (p: s2.S2Paper) =>
    `- **${p.title}** (${p.year ?? "?"})${p.citationCount != null ? `  ·  ${p.citationCount} citations` : ""}${
      p.externalIds?.ArXiv ? `  ·  [arXiv](https://arxiv.org/abs/${p.externalIds.ArXiv})` : ""
    }`;

  return `# Reading order: ${topic}

Three tiers. Read top-down.

## Tier 1 — Foundation (read first)

${foundation.map(fmt).join("\n")}

## Tier 2 — Core readings

${core.map(fmt).join("\n")}

## Tier 3 — Frontier (recent work)

${frontier.map(fmt).join("\n")}

${
  surveys.length > 0
    ? `## Surveys / reviews

${surveys.map(fmt).join("\n")}`
    : ""
}

---
_Generated by \`peer map "${topic}"\`. Reorder as you learn more._
`;
}

function generateSubfieldsDoc(topic: string, subfields: Subfield[]): string {
  let out = `# Subfields of ${topic}\n\n`;
  for (const s of subfields) {
    out += `## ${s.label}\n\n`;
    out += `**${s.papers.length} papers in this cluster.**\n\n`;
    out += `### Foundational\n\n`;
    out += s.foundational
      .map(
        (p) =>
          `- [[${p.title}]] (${p.year ?? "?"}, ${p.citationCount ?? 0} cites)${
            p.externalIds?.ArXiv ? ` — arXiv:${p.externalIds.ArXiv}` : ""
          }`,
      )
      .join("\n");
    out += `\n\n### Frontier (most recent)\n\n`;
    out += s.frontier.map((p) => `- [[${p.title}]] (${p.year ?? "?"})`).join("\n");
    out += `\n\n---\n\n`;
  }
  return out;
}

function topicSlug(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}
