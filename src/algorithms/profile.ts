/**
 * Profile builder — the algorithm that turns "user's publications" into a
 * persistent profile for prof.
 *
 * Inputs (one of):
 *   - a list of resolved S2 papers (when we came in via S2 author search /
 *     batch lookup from a Scholar URL)
 *   - a list of arxiv ids (fetched directly via the arxiv client)
 *
 * Output:
 *   - profile.md at ~/.prof/profile.md with YAML frontmatter capturing
 *     name, scholar_url, primary_subfield, secondary_subfields, coauthors,
 *     onboarded_at
 *   - papers persisted to SQLite
 *   - concepts persisted to L2 graph (one LLM extraction per paper)
 *   - returns aggregate counts so the seed-library step can iterate them
 *
 * v0.0.1 scope:
 *   - concept aggregation is frequency-count across user papers
 *   - co-author aggregation is name-string normalized count
 *   - primary subfield := most-frequent concept; secondary := next 2-4
 *   - "method style" / "trajectory" fields are intentionally NOT inferred
 *     by an LLM in v0 — they require more papers than most users have on
 *     hand at onboarding. We leave that for v0.1.
 */
import * as fs from "node:fs";
import { paths, ensureDirs } from "../config/paths.js";
import * as s2 from "../api/semantic-scholar.js";
import * as ax from "../api/arxiv.js";
import {
  paperCanonicalId,
  upsertPaper,
  upsertAuthor,
  upsertAuthored,
  upsertConcept,
  linkPaperConcept,
  runTransaction,
} from "../db/client.js";
import { complete, MODELS } from "../lib/llm.js";

/** Top-level result of the profile-build step. */
export interface UserPaper {
  /** Canonical id used as the primary key in SQLite. */
  paperId: string;
  /** Title as we stored it. */
  title: string;
  /** Year, if known. */
  year: number | null;
  /** arxiv id, if known. */
  arxivId: string | null;
  /** S2 id, if known. */
  s2Id: string | null;
  /** Concepts extracted from this paper's abstract. */
  concepts: string[];
  /** Co-authors found on this paper, normalized. */
  coauthors: string[];
}

export interface ProfileBuildResult {
  /** Resolved publications attributed to the user. */
  papers: UserPaper[];
  /** Top concepts by frequency (descending). */
  topConcepts: Array<{ name: string; count: number }>;
  /** Co-authors by paper count (descending). */
  topCoauthors: Array<{ name: string; count: number }>;
  /** Primary subfield label (top concept, falsy if none). */
  primarySubfield: string | null;
  /** Secondary subfield labels (next 2-4 concepts). */
  secondarySubfields: string[];
  /** Aggregate LLM cost. */
  cost: number;
  /** Where we wrote profile.md. */
  profilePath: string;
}

export interface BuildProfileInput {
  /** Free-form name to write into profile.md. May be null. */
  name: string | null;
  /** Scholar URL (or bare user id) we onboarded from, if any. */
  scholarUrl: string | null;
  /** Affiliation line, if any. */
  affiliation: string | null;
  /** S2 papers, if we resolved any (Scholar URL → S2 author search route). */
  s2Papers: s2.S2Paper[];
  /** Arxiv entries, if we resolved any (paste-arxiv-IDs route). */
  arxivEntries: ax.ArxivEntry[];
  /** Verbose logger (per-line). */
  log?: (msg: string) => void;
}

/**
 * Resolve a Google Scholar user id to a list of S2 papers via the S2 author search.
 *
 * S2 lets us search by name but not by Scholar id. We use the display name from
 * the parsed Scholar profile as the lookup key. This is brittle for common
 * names — onboarding tells the user when we found zero or many candidates.
 */
export async function resolveAuthorByName(name: string): Promise<s2.S2Paper[]> {
  // S2 "search by author name" is not part of the simple paper search.
  // We approximate: search papers by `${name}` query and filter post-hoc to
  // papers whose first/second author shares the surname. v0.0.1 — good enough.
  const surname = name.trim().split(/\s+/).slice(-1)[0]?.toLowerCase() ?? "";
  if (!surname) return [];

  const resp = await s2.searchPapers(name, { limit: 50 });
  return resp.data.filter((p) =>
    (p.authors ?? []).some((a) => (a.name ?? "").toLowerCase().includes(surname)),
  );
}

/**
 * Persist a single S2Paper to SQLite as a "user publication".
 * Returns the canonical paper id.
 */
function persistS2Paper(p: s2.S2Paper): string {
  const arxivId = p.externalIds?.ArXiv ?? null;
  const doi = p.externalIds?.DOI ?? null;
  const id = paperCanonicalId({
    arxiv_id: arxivId,
    doi,
    s2_id: p.paperId,
    title: p.title,
    year: p.year ?? null,
  });
  upsertPaper({
    id,
    s2_id: p.paperId,
    doi,
    arxiv_id: arxivId,
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
  return id;
}

/** Persist an arxiv entry as a user publication. */
function persistArxivEntry(e: ax.ArxivEntry): string {
  const year = e.published ? parseInt(e.published.slice(0, 4), 10) : null;
  const id = paperCanonicalId({
    arxiv_id: e.id,
    doi: null,
    s2_id: null,
    title: e.title,
    year,
  });
  upsertPaper({
    id,
    s2_id: null,
    doi: null,
    arxiv_id: e.id,
    title: e.title,
    abstract: e.summary || null,
    year,
    venue: null,
    citations_count: 0,
    references_count: 0,
    pdf_path: null,
    source: "arxiv",
    raw_json: JSON.stringify(e),
  });
  return id;
}

/**
 * LLM concept extraction — same shape as `read.ts` but trimmed to concepts.
 * One round-trip per paper. Caller is responsible for batching / progress.
 */
async function extractConceptsForPaper(args: {
  title: string;
  authors: string[];
  year: number | null;
  abstract: string;
}): Promise<{ concepts: string[]; cost: number }> {
  const system =
    "You extract concept tags from an academic paper's title + abstract. " +
    "Output ONLY a JSON array of 3-7 short concept strings. No prose. " +
    'Example: ["diffusion models", "guidance", "video generation"]. ' +
    "Never invent concepts not implied by the abstract.";
  const prompt =
    `Title: ${args.title}\n` +
    `Authors: ${args.authors.slice(0, 4).join(", ")}${args.authors.length > 4 ? " et al." : ""}\n` +
    `Year: ${args.year ?? "unknown"}\n\n` +
    `Abstract:\n${args.abstract}\n\n` +
    `Output ONLY a JSON array of 3-7 concept strings.`;
  const { text, cost } = await complete({
    model: MODELS.cheap,
    system,
    prompt,
    maxTokens: 300,
    temperature: 0.2,
  });
  let concepts: string[] = [];
  try {
    const m = text.match(/\[[\s\S]*\]/);
    if (m) {
      const parsed = JSON.parse(m[0]) as unknown;
      if (Array.isArray(parsed)) {
        concepts = parsed
          .map((x) => (typeof x === "string" ? x.trim() : ""))
          .filter((x) => x.length > 0);
      }
    }
  } catch {
    /* swallow — concepts stays [] */
  }
  return { concepts, cost: cost.costUsd };
}

/**
 * Normalize a concept name for frequency counting.
 * (We use the raw display form as the dict key but lowercase to merge.)
 */
function normalizeConcept(c: string): string {
  return c.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Same but for co-author names. */
function normalizeName(n: string): string {
  return n.trim().replace(/\s+/g, " ");
}

/**
 * Build the profile end-to-end.
 *
 * Behavior:
 *   1. Persist each S2 paper / arxiv entry as a user publication.
 *   2. Extract concepts via LLM for each paper that has an abstract.
 *   3. Aggregate concepts and co-authors.
 *   4. Write profile.md.
 *   5. Persist authored relations and concept edges in one transaction.
 */
export async function buildProfile(input: BuildProfileInput): Promise<ProfileBuildResult> {
  ensureDirs();
  const log = input.log ?? (() => {});

  const userPapers: UserPaper[] = [];
  let cost = 0;

  // ---- Step 1+2: persist + extract concepts ----
  const total = input.s2Papers.length + input.arxivEntries.length;
  let idx = 0;
  for (const p of input.s2Papers) {
    idx++;
    if (!p.title) continue;
    log(`(${idx}/${total}) ${p.title.slice(0, 70)}`);
    const paperId = persistS2Paper(p);
    const coauthors = (p.authors ?? [])
      .map((a) => normalizeName(a.name ?? ""))
      .filter((n) => n.length > 0);

    let concepts: string[] = [];
    if (p.abstract && p.abstract.length > 50) {
      try {
        const r = await extractConceptsForPaper({
          title: p.title,
          authors: coauthors,
          year: p.year ?? null,
          abstract: p.abstract,
        });
        concepts = r.concepts;
        cost += r.cost;
      } catch (err) {
        log(`  ! concept extraction failed: ${(err as Error).message}`);
      }
    }

    userPapers.push({
      paperId,
      title: p.title,
      year: p.year ?? null,
      arxivId: p.externalIds?.ArXiv ?? null,
      s2Id: p.paperId,
      concepts,
      coauthors,
    });

    // Persist graph: authors + concepts.
    try {
      runTransaction(() => {
        (p.authors ?? []).forEach((author, i) => {
          if (!author.name) return;
          const authorId = upsertAuthor({
            s2_author_id: author.authorId ?? null,
            name: author.name,
            h_index: author.hIndex ?? null,
            affiliations: [],
          });
          upsertAuthored({ paper_id: paperId, author_id: authorId, position: i + 1 });
        });
        for (const c of concepts) {
          const cn = upsertConcept({ name: c, paper_id: paperId, paper_year: p.year ?? null });
          linkPaperConcept({ paper_id: paperId, concept_id: cn.id, relation: cn.relation });
        }
      });
    } catch (err) {
      log(`  ! graph write failed for ${paperId}: ${(err as Error).message}`);
    }
  }

  for (const e of input.arxivEntries) {
    idx++;
    if (!e.title) continue;
    log(`(${idx}/${total}) ${e.title.slice(0, 70)}`);
    const paperId = persistArxivEntry(e);
    const coauthors = (e.authors ?? []).map(normalizeName).filter((n) => n.length > 0);
    const year = e.published ? parseInt(e.published.slice(0, 4), 10) : null;

    let concepts: string[] = [];
    if (e.summary && e.summary.length > 50) {
      try {
        const r = await extractConceptsForPaper({
          title: e.title,
          authors: coauthors,
          year,
          abstract: e.summary,
        });
        concepts = r.concepts;
        cost += r.cost;
      } catch (err) {
        log(`  ! concept extraction failed: ${(err as Error).message}`);
      }
    }

    userPapers.push({
      paperId,
      title: e.title,
      year,
      arxivId: e.id,
      s2Id: null,
      concepts,
      coauthors,
    });

    try {
      runTransaction(() => {
        coauthors.forEach((name, i) => {
          const authorId = upsertAuthor({
            s2_author_id: null,
            name,
            h_index: null,
            affiliations: [],
          });
          upsertAuthored({ paper_id: paperId, author_id: authorId, position: i + 1 });
        });
        for (const c of concepts) {
          const cn = upsertConcept({ name: c, paper_id: paperId, paper_year: year });
          linkPaperConcept({ paper_id: paperId, concept_id: cn.id, relation: cn.relation });
        }
      });
    } catch (err) {
      log(`  ! graph write failed for ${paperId}: ${(err as Error).message}`);
    }
  }

  // ---- Step 3: aggregate ----
  const conceptCounts = new Map<string, { display: string; count: number }>();
  for (const up of userPapers) {
    const seen = new Set<string>();
    for (const c of up.concepts) {
      const key = normalizeConcept(c);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const cur = conceptCounts.get(key);
      if (cur) {
        cur.count += 1;
      } else {
        conceptCounts.set(key, { display: c.trim(), count: 1 });
      }
    }
  }

  const topConcepts = [...conceptCounts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
    .map((c) => ({ name: c.display, count: c.count }));

  const coauthorCounts = new Map<string, number>();
  // Exclude the user themselves (best-effort: drop the most-frequent author IF
  // it appears on ALL papers AND matches input.name surname). Cheap heuristic.
  const userSurname = input.name ? input.name.trim().split(/\s+/).slice(-1)[0]?.toLowerCase() : null;
  for (const up of userPapers) {
    const seen = new Set<string>();
    for (const name of up.coauthors) {
      const key = name.toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      if (userSurname && key.includes(userSurname)) {
        // Likely the user themselves; skip.
        continue;
      }
      coauthorCounts.set(name, (coauthorCounts.get(name) ?? 0) + 1);
    }
  }

  const topCoauthors = [...coauthorCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  const primarySubfield = topConcepts[0]?.name ?? null;
  const secondarySubfields = topConcepts.slice(1, 4).map((c) => c.name);

  // ---- Step 4: write profile.md ----
  const profilePath = paths.profile();
  fs.writeFileSync(
    profilePath,
    formatProfile({
      name: input.name,
      scholarUrl: input.scholarUrl,
      affiliation: input.affiliation,
      primarySubfield,
      secondarySubfields,
      coauthors: topCoauthors,
      papers: userPapers,
    }),
  );

  return {
    papers: userPapers,
    topConcepts,
    topCoauthors,
    primarySubfield,
    secondarySubfields,
    cost,
    profilePath,
  };
}

// ============================================================
// profile.md formatting
// ============================================================

function formatProfile(args: {
  name: string | null;
  scholarUrl: string | null;
  affiliation: string | null;
  primarySubfield: string | null;
  secondarySubfields: string[];
  coauthors: Array<{ name: string; count: number }>;
  papers: UserPaper[];
}): string {
  const yToday = new Date().toISOString().slice(0, 10);
  const fm = [
    "---",
    `name: ${yamlString(args.name ?? "")}`,
    args.scholarUrl ? `scholar_url: ${yamlString(args.scholarUrl)}` : null,
    args.affiliation ? `affiliation: ${yamlString(args.affiliation)}` : null,
    `primary_subfield: ${yamlString(args.primarySubfield ?? "")}`,
    `secondary_subfields: [${args.secondarySubfields.map(yamlString).join(", ")}]`,
    `coauthors: [${args.coauthors.map((c) => yamlString(c.name)).join(", ")}]`,
    `paper_count: ${args.papers.length}`,
    `onboarded_at: ${yToday}`,
    "---",
  ]
    .filter((l): l is string => l !== null)
    .join("\n");

  const papersBlock = args.papers
    .slice()
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
    .map((p) => {
      const arxiv = p.arxivId ? `  ·  [arXiv:${p.arxivId}](https://arxiv.org/abs/${p.arxivId})` : "";
      return `- **${p.title}** (${p.year ?? "?"})${arxiv}`;
    })
    .join("\n");

  const coauthorBlock = args.coauthors.length
    ? args.coauthors.map((c) => `- ${c.name} (${c.count})`).join("\n")
    : "_none identified_";

  const subfieldBlock = args.secondarySubfields.length
    ? args.secondarySubfields.map((s) => `- ${s}`).join("\n")
    : "_none_";

  return `${fm}

# ${args.name ?? "Your profile"}

${args.affiliation ? `**${args.affiliation}**\n\n` : ""}_Onboarded ${yToday}. ${args.papers.length} publications indexed._

## Subfields

**Primary**: ${args.primarySubfield ?? "_not detected_"}

**Secondary**:
${subfieldBlock}

## Co-authors (by paper count)

${coauthorBlock}

## Publications

${papersBlock || "_none — onboarding skipped or failed_"}

---
_Edit this file by hand. \`prof\` reads the YAML frontmatter at the top to personalize future commands._
`;
}

function yamlString(s: string): string {
  const cleaned = s
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 500);
  return `"${cleaned.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
