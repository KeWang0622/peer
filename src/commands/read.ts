/**
 * `peer read <pdf|arxiv-id|url>`
 *
 * v0.0.1-alpha scope (per viral-validation cuts):
 *   - default: abstract-only (no Marker PDF parse)
 *   - LLM extracts contribution / method / data / metric from abstract
 *   - writes markdown note to ~/.peer/notes/papers/<slug>.md
 *   - writes the paper row, then best-effort persists L1/L2 graph rows:
 *     authors/authored, concepts/paper_concepts, methods/paper_methods,
 *     datasets/paper_datasets, and metric nodes. Graph writes are one
 *     SQLite transaction and warn rather than failing note generation.
 *
 * --full flag: TODO post-launch — pull PDF, parse with Marker, extract from full text.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { paths, ensureDirs } from "../config/paths.js";
import {
  getPaper,
  linkPaperConcept,
  linkPaperDataset,
  linkPaperMethod,
  paperCanonicalId,
  runTransaction,
  upsertAuthor,
  upsertAuthored,
  upsertConcept,
  upsertDataset,
  upsertMethod,
  upsertMetric,
  upsertPaper,
} from "../db/client.js";
import * as s2 from "../api/semantic-scholar.js";
import * as ax from "../api/arxiv.js";
import { complete, MODELS } from "../lib/llm.js";

export interface ReadResult {
  paperId: string;
  notePath: string;
  title: string;
  cost: number;
}

export async function profRead(input: string, opts: { verbose?: boolean } = {}): Promise<ReadResult> {
  ensureDirs();

  const log = (msg: string) => {
    if (opts.verbose) console.log(`  ${msg}`);
  };

  // Step 1: resolve identifier (arxiv id, arxiv URL, doi, doi URL, s2 paper id)
  const resolved = resolveIdentifier(input);
  const { arxivId, doi, s2Id } = resolved;
  if (!arxivId && !doi && !s2Id) {
    throw new Error(
      `Could not resolve "${input}" as arxiv id, DOI, or paper URL. ` +
        `Try: peer read 2402.04494  |  peer read 10.1234/abc  |  peer read https://arxiv.org/abs/2402.04494`,
    );
  }

  log(`Resolving: arxiv=${arxivId}, doi=${doi}, s2=${s2Id}`);

  // Step 2: fetch metadata via Semantic Scholar
  let s2Paper: s2.S2Paper | null = null;
  const lookupId = arxivId ? `arXiv:${arxivId}` : doi ? `DOI:${doi}` : s2Id;
  if (!lookupId) throw new Error(`Could not resolve input: ${input}`);

  try {
    s2Paper = await s2.getPaper(lookupId);
  } catch (err) {
    log(`Semantic Scholar lookup failed: ${(err as Error).message}`);
  }

  // Fallback: arxiv direct
  let abstractText: string | null = s2Paper?.abstract ?? null;
  let title: string | null = s2Paper?.title ?? null;
  let year: number | null = s2Paper?.year ?? null;
  let authors: string[] = s2Paper?.authors?.map((a) => a.name) ?? [];

  if ((!abstractText || !title) && arxivId) {
    try {
      const ent = await ax.getArxivById(arxivId);
      if (ent) {
        abstractText = abstractText ?? ent.summary;
        title = title ?? ent.title;
        if (!year && ent.published) year = parseInt(ent.published.slice(0, 4), 10);
        if (authors.length === 0) authors = ent.authors;
      }
    } catch (err) {
      log(`arXiv lookup failed: ${(err as Error).message}`);
    }
  }

  if (!title) throw new Error(`Could not fetch paper metadata for: ${input}`);
  if (!abstractText) abstractText = "(no abstract available)";

  // Step 3: canonical id + persist to L1
  const canonicalId = paperCanonicalId({
    arxiv_id: arxivId ?? s2Paper?.externalIds?.ArXiv ?? null,
    doi: doi ?? s2Paper?.externalIds?.DOI ?? null,
    s2_id: s2Paper?.paperId ?? null,
    title,
    year,
  });

  const existing = getPaper(canonicalId);
  log(existing ? `Already in library, updating` : `New paper`);

  upsertPaper({
    id: canonicalId,
    s2_id: s2Paper?.paperId ?? null,
    doi: doi ?? s2Paper?.externalIds?.DOI ?? null,
    arxiv_id: arxivId ?? s2Paper?.externalIds?.ArXiv ?? null,
    title,
    abstract: abstractText,
    year,
    venue: s2Paper?.venue ?? null,
    citations_count: s2Paper?.citationCount ?? 0,
    references_count: s2Paper?.referenceCount ?? 0,
    pdf_path: null,
    source: s2Paper ? "semantic-scholar" : "arxiv",
    raw_json: s2Paper ? JSON.stringify(s2Paper) : null,
  });

  // Step 4: LLM extraction (abstract-only for v0.0.1)
  log(`Extracting semantic structure with ${MODELS.smart}`);
  const { text: extractionJson, cost } = await complete({
    model: MODELS.smart,
    system: extractionSystem(),
    prompt: extractionPrompt({ title, authors, year, abstract: abstractText }),
    maxTokens: 1500,
    temperature: 0.2,
  });

  let extraction: PaperExtraction;
  try {
    extraction = JSON.parse(extractCodeBlock(extractionJson));
  } catch (err) {
    log(`Failed to parse extraction JSON: ${(err as Error).message}`);
    extraction = {
      contribution: "(extraction failed)",
      method: { type: "unknown", key_idea: "" },
      datasets: [],
      metrics: [],
      key_innovation: "",
      limitations: [],
      concepts: [],
    };
  }

  try {
    persistReadGraph({
      paperId: canonicalId,
      year,
      s2Authors: s2Paper?.authors ?? [],
      extraction,
    });
  } catch (err) {
    console.warn(`Warning: graph write failed for ${canonicalId}: ${(err as Error).message}`);
  }

  // Step 5: write note
  const slug = makeSlug(title, year);
  const notePath = path.join(paths.papersNotes(), `${slug}.md`);
  fs.writeFileSync(notePath, formatNote({ canonicalId, title, year, authors, abstractText, arxivId, doi, s2Paper, extraction }));

  return {
    paperId: canonicalId,
    notePath,
    title,
    cost: cost.costUsd,
  };
}

// ============================================================
// Prompts
// ============================================================

function extractionSystem(): string {
  return `You are an extraction component of peer, a research operating system.
You take an academic paper's title + abstract and extract its key semantic structure.
Output ONLY a JSON object matching the requested schema. No prose, no markdown fences.
Be precise. If a field cannot be determined from the abstract alone, use empty string or empty array.
Never invent specifics that aren't in the abstract.`;
}

function extractionPrompt(p: {
  title: string;
  authors: string[];
  year: number | null;
  abstract: string;
}): string {
  return `Paper:
Title: ${p.title}
Authors: ${p.authors.slice(0, 4).join(", ")}${p.authors.length > 4 ? " et al." : ""}
Year: ${p.year ?? "unknown"}

Abstract:
${p.abstract}

Extract a JSON object with this exact shape:

{
  "contribution": "one-sentence stated contribution",
  "method": {
    "type": "supervised | unsupervised | self-supervised | RL | theory | empirical | survey | other",
    "key_idea": "1-2 sentences"
  },
  "datasets": ["dataset names mentioned"],
  "metrics": ["evaluation metrics mentioned"],
  "key_innovation": "the single most distinctive technical idea (1 sentence)",
  "limitations": ["stated limitations, if any"],
  "concepts": ["3-7 short concept tags, e.g. 'diffusion models', 'sparse autoencoders'"]
}

Output the JSON object only.`;
}

interface PaperExtraction {
  contribution: string;
  method: { type: string; key_idea: string };
  datasets: string[];
  metrics: string[];
  key_innovation: string;
  limitations: string[];
  concepts: string[];
}

// ============================================================
// Helpers
// ============================================================

function persistReadGraph(args: {
  paperId: string;
  year: number | null;
  s2Authors: s2.S2Author[];
  extraction: PaperExtraction;
}): void {
  runTransaction(() => {
    args.s2Authors.forEach((author, idx) => {
      const name = author.name?.trim();
      if (!name) return;
      const authorId = upsertAuthor({
        s2_author_id: author.authorId ?? null,
        name,
        h_index: author.hIndex ?? null,
        affiliations: [],
      });
      upsertAuthored({ paper_id: args.paperId, author_id: authorId, position: idx + 1 });
    });

    for (const conceptName of asStringArray(args.extraction.concepts)) {
      const concept = upsertConcept({
        name: conceptName,
        paper_id: args.paperId,
        paper_year: args.year,
      });
      linkPaperConcept({
        paper_id: args.paperId,
        concept_id: concept.id,
        relation: concept.relation,
      });
    }

    const methodName = args.extraction.method?.key_idea?.trim();
    if (methodName) {
      const category = args.extraction.method.type?.trim().toLowerCase() || null;
      const methodId = upsertMethod({ name: methodName, category });
      linkPaperMethod({
        paper_id: args.paperId,
        method_id: methodId,
        relation: category === "survey" ? "mentions" : "uses",
      });
    }

    for (const datasetName of asStringArray(args.extraction.datasets)) {
      const datasetId = upsertDataset({ name: datasetName, modality: null });
      linkPaperDataset({ paper_id: args.paperId, dataset_id: datasetId });
    }

    for (const metricName of asStringArray(args.extraction.metrics)) {
      upsertMetric({ name: metricName });
    }
  });
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter((item) => item.length > 0);
}

/** Quote a string for safe inclusion in YAML frontmatter (single-line strings only). */
function yamlString(s: string): string {
  // Strip control chars except for tab/newline (which we then collapse), wrap in double quotes
  const cleaned = s
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "") // strip control chars
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 500); // cap pathological lengths
  return `"${cleaned.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Use plain scalar if safe, otherwise quote. */
function yamlScalar(s: string): string {
  // Plain scalar rules (subset): no leading -, ?, :, etc; no special yaml chars; no spaces at start
  if (/^[A-Za-z0-9_./:-]+$/.test(s) && !/^(true|false|null|yes|no|on|off)$/i.test(s)) {
    return s;
  }
  return yamlString(s);
}

interface ResolvedId {
  arxivId: string | null;
  doi: string | null;
  s2Id: string | null;
}

/** Resolve arxiv id / DOI / S2 id / common URL forms. Returns nulls if unresolvable. */
function resolveIdentifier(input: string): ResolvedId {
  const trimmed = input.trim().replace(/\/+$/, "");
  // 1) arxiv id direct (1706.03762 or 1706.03762v5 etc.)
  if (ax.isArxivId(trimmed)) {
    return { arxivId: trimmed.replace(/^arxiv:/i, "").replace(/v\d+$/, ""), doi: null, s2Id: null };
  }
  // 2) URL forms — parse structurally so query/fragment don't leak in
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed);
      const host = u.hostname.toLowerCase();
      const pathParts = u.pathname.split("/").filter(Boolean);

      // arxiv.org/abs/<id> or arxiv.org/pdf/<id>.pdf
      if (host.endsWith("arxiv.org") && (pathParts[0] === "abs" || pathParts[0] === "pdf")) {
        const id = (pathParts.slice(1).join("/") || "").replace(/\.pdf$/i, "").replace(/v\d+$/, "");
        if (id) return { arxivId: id, doi: null, s2Id: null };
      }

      // doi.org/<doi> or dx.doi.org/<doi>
      if (host === "doi.org" || host === "dx.doi.org" || host.endsWith(".doi.org")) {
        const doi = decodeURIComponent(pathParts.join("/"));
        if (/^10\.\d{4,9}\//.test(doi)) return { arxivId: null, doi, s2Id: null };
      }

      // semanticscholar.org/paper/<title>/<40-hex>  (40-hex is the corpus id)
      if (host.endsWith("semanticscholar.org") && pathParts[0] === "paper") {
        const sha = pathParts.find((p) => /^[0-9a-f]{40}$/i.test(p));
        if (sha) return { arxivId: null, doi: null, s2Id: sha };
      }
    } catch {
      // fall through to regex paths
    }
  }
  // 3) raw DOI
  if (/^10\.\d{4,9}\/\S+$/.test(trimmed)) {
    return { arxivId: null, doi: trimmed, s2Id: null };
  }
  // 4) DOI: prefix
  if (/^DOI:/i.test(trimmed)) {
    return { arxivId: null, doi: trimmed.replace(/^DOI:/i, ""), s2Id: null };
  }
  // 5) S2 40-hex id
  if (/^[0-9a-f]{40}$/i.test(trimmed)) {
    return { arxivId: null, doi: null, s2Id: trimmed };
  }
  return { arxivId: null, doi: null, s2Id: null };
}

function extractCodeBlock(s: string): string {
  // Strip markdown fences if present
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) return fenced[1].trim();
  return s.trim();
}

function makeSlug(title: string, year: number | null): string {
  const yearPart = year ? `${year}-` : "";
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return `${yearPart}${slug}`;
}

function formatNote(args: {
  canonicalId: string;
  title: string;
  year: number | null;
  authors: string[];
  abstractText: string;
  arxivId: string | null;
  doi: string | null;
  s2Paper: s2.S2Paper | null;
  extraction: PaperExtraction;
}): string {
  // Defensive normalization in case LLM extraction returned nullish for some fields
  const e = args.extraction;
  const safe = {
    contribution: typeof e.contribution === "string" ? e.contribution : "",
    method: {
      type: e.method?.type ?? "unknown",
      key_idea: e.method?.key_idea ?? "",
    },
    datasets: asStringArray(e.datasets),
    metrics: asStringArray(e.metrics),
    key_innovation: typeof e.key_innovation === "string" ? e.key_innovation : "",
    limitations: asStringArray(e.limitations),
    concepts: asStringArray(e.concepts),
  };

  const fm = [
    "---",
    `id: ${yamlScalar(args.canonicalId)}`,
    `title: ${yamlString(args.title)}`,
    `year: ${args.year ?? "null"}`,
    `authors: [${args.authors.slice(0, 8).map(yamlString).join(", ")}]`,
    args.arxivId ? `arxiv: ${yamlScalar(args.arxivId)}` : null,
    args.doi ? `doi: ${yamlScalar(args.doi)}` : null,
    args.s2Paper?.venue ? `venue: ${yamlString(args.s2Paper.venue)}` : null,
    args.s2Paper?.citationCount != null ? `citations: ${args.s2Paper.citationCount}` : null,
    `read_at: ${new Date().toISOString().slice(0, 10)}`,
    `concepts: [${safe.concepts.map(yamlString).join(", ")}]`,
    "---",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  const body = `
# ${args.title}

**${args.authors.slice(0, 4).join(", ")}${args.authors.length > 4 ? " et al." : ""}**  ·  ${args.year ?? "??"}${args.s2Paper?.venue ? `  ·  ${args.s2Paper.venue}` : ""}${args.s2Paper?.citationCount != null ? `  ·  ${args.s2Paper.citationCount} citations` : ""}

${args.arxivId ? `[arXiv:${args.arxivId}](https://arxiv.org/abs/${args.arxivId})` : ""}${args.doi ? ` · [DOI](https://doi.org/${args.doi})` : ""}

## Contribution

${safe.contribution || "_not extracted_"}

## Method

**Type**: ${safe.method.type}

${safe.method.key_idea || "_not extracted_"}

## Key innovation

${safe.key_innovation || "_not extracted_"}

## Datasets

${safe.datasets.length ? safe.datasets.map((d) => `- ${d}`).join("\n") : "_none specified in abstract_"}

## Metrics

${safe.metrics.length ? safe.metrics.map((m) => `- ${m}`).join("\n") : "_none specified in abstract_"}

## Limitations

${safe.limitations.length ? safe.limitations.map((l) => `- ${l}`).join("\n") : "_none stated_"}

## Concepts

${safe.concepts.length ? safe.concepts.map((c) => `[[${c}]]`).join(" · ") : "_none extracted_"}

## Abstract

> ${args.abstractText.split("\n").join("\n> ")}

---
*Extracted by prof. ${new Date().toLocaleDateString()}*
`;

  return fm + "\n" + body;
}
