/**
 * `prof next "<goal>"` — what should I read next, given my journey so far.
 *
 * This is the cohesion glue. It uses your library + action history + a goal
 * to recommend the single most useful next paper.
 *
 * Usage:
 *   prof next "write a sparse autoencoder paper"
 *   prof next                  → continue your most recent active trail
 */
import { randomUUID, createHash } from "node:crypto";
import { db, type PaperRow, paperCanonicalId, upsertPaper, nowEpoch } from "../db/client.js";
import { embedCached, embedOneCached } from "../db/embeddings-cache.js";
import { complete, MODELS, totalCostUsd } from "../lib/llm.js";
import * as s2 from "../api/semantic-scholar.js";
import { c } from "../tui/colors.js";

interface TrailRow {
  id: string;
  goal: string;
  created_at: number;
  status: string;
}

interface TrailStep {
  trail_id: string;
  position: number;
  paper_id: string;
  why: string | null;
  status: string;
  added_at: number;
  completed_at: number | null;
}

function trailIdForGoal(goal: string): string {
  return "trail-" + createHash("sha256").update(goal.toLowerCase().trim()).digest("hex").slice(0, 12);
}

function getActiveTrail(): TrailRow | null {
  return (
    db()
      .prepare<[], TrailRow>(
        "SELECT * FROM trails WHERE status='active' ORDER BY created_at DESC LIMIT 1",
      )
      .get() ?? null
  );
}

function ensureTrail(goal: string): TrailRow {
  const id = trailIdForGoal(goal);
  const existing = db().prepare<[string], TrailRow>("SELECT * FROM trails WHERE id = ?").get(id);
  if (existing) return existing;

  const now = nowEpoch();
  db()
    .prepare("INSERT INTO trails (id, goal, created_at, status) VALUES (?, ?, ?, 'active')")
    .run(id, goal, now);
  return { id, goal, created_at: now, status: "active" };
}

function trailSteps(trailId: string): TrailStep[] {
  return db()
    .prepare<[string], TrailStep>(
      "SELECT * FROM trail_steps WHERE trail_id = ? ORDER BY position",
    )
    .all(trailId);
}

function recentReadPaperIds(limit = 10): string[] {
  return db()
    .prepare<[number], { id: string }>(
      "SELECT id FROM papers ORDER BY ingested_at DESC LIMIT ?",
    )
    .all(limit)
    .map((r) => r.id);
}

interface Candidate {
  id: string;
  title: string;
  year: number | null;
  abstract: string;
  citations: number;
  externalId: string;
  arxivId: string | null;
  doi: string | null;
  s2Id: string | null;
  similarity: number;
  source: "library-unread" | "external";
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const ai = a[i] ?? 0, bi = b[i] ?? 0;
    dot += ai * bi; na += ai * ai; nb += bi * bi;
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

export async function cmdNext(goalArg: string | null, opts: { verbose?: boolean } = {}): Promise<void> {
  const log = (m: string) => opts.verbose && console.log(c.dim(`  · ${m}`));
  const costBefore = totalCostUsd();

  // Resolve goal: explicit, or fall back to most recent active trail
  let goal = goalArg?.trim() ?? "";
  let trail: TrailRow;
  if (!goal) {
    const active = getActiveTrail();
    if (!active) {
      console.error('Usage: prof next "<your research goal>"');
      console.error("(no prior trail found — give a goal to start one)");
      process.exit(1);
    }
    trail = active;
    goal = trail.goal;
    log(`continuing trail: ${trail.id}`);
  } else {
    trail = ensureTrail(goal);
  }

  const steps = trailSteps(trail.id);
  const readPaperIds = new Set(recentReadPaperIds(100));
  const queuedPaperIds = new Set(steps.map((s) => s.paper_id));

  console.log();
  console.log(c.primary("trail: ") + c.italic(goal));
  if (steps.length > 0) {
    const done = steps.filter((s) => s.status === "done").length;
    console.log(c.dim(`  ${done}/${steps.length} steps complete`));
  }
  console.log();

  // Embed the goal
  const goalVec = await embedOneCached("query", `goal:${goal}`, goal);

  // Build candidate pool
  const candidates: Candidate[] = [];

  // 1. Library papers NOT yet read in this trail (continue what you started)
  const libraryUnread = db()
    .prepare<[], PaperRow>("SELECT * FROM papers WHERE abstract IS NOT NULL ORDER BY ingested_at DESC LIMIT 100")
    .all()
    .filter((p) => !queuedPaperIds.has(p.id))
    .filter((p) => p.abstract && p.abstract.length > 80);

  if (libraryUnread.length > 0) {
    const libItems = libraryUnread.map((p) => ({
      id: p.id,
      text: `${p.title}\n\n${p.abstract ?? ""}`,
    }));
    const libVecs = await embedCached("paper-title-abstract", libItems);
    for (const p of libraryUnread) {
      const v = libVecs.get(p.id);
      if (!v) continue;
      candidates.push({
        id: p.id,
        title: p.title,
        year: p.year,
        abstract: p.abstract ?? "",
        citations: p.citations_count ?? 0,
        externalId: p.arxiv_id ?? p.doi ?? p.s2_id ?? p.id,
        arxivId: p.arxiv_id,
        doi: p.doi,
        s2Id: p.s2_id,
        similarity: cosine(goalVec, v),
        source: "library-unread",
      });
    }
  }

  // 2. External candidates from S2 (or skip silently)
  try {
    log("searching external literature");
    const resp = await s2.searchPapers(goal, { limit: 15 });
    const fresh = resp.data.filter((p) => p.abstract && p.abstract.length > 80);
    if (fresh.length > 0) {
      const extItems = fresh.map((p) => {
        const id = paperCanonicalId({
          arxiv_id: p.externalIds?.ArXiv ?? null,
          doi: p.externalIds?.DOI ?? null,
          s2_id: p.paperId,
          title: p.title,
          year: p.year ?? null,
        });
        return { id, text: `${p.title}\n\n${p.abstract}` };
      });
      const extVecs = await embedCached("paper-title-abstract", extItems);
      fresh.forEach((p, i) => {
        const id = extItems[i]!.id;
        if (queuedPaperIds.has(id) || readPaperIds.has(id)) return;
        const v = extVecs.get(id);
        if (!v) return;
        // Persist into library so a future read/ask picks it up
        upsertPaper({
          id,
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
        candidates.push({
          id,
          title: p.title,
          year: p.year ?? null,
          abstract: p.abstract ?? "",
          citations: p.citationCount ?? 0,
          externalId: p.externalIds?.ArXiv ?? p.externalIds?.DOI ?? p.paperId,
          arxivId: p.externalIds?.ArXiv ?? null,
          doi: p.externalIds?.DOI ?? null,
          s2Id: p.paperId,
          similarity: cosine(goalVec, v),
          source: "external",
        });
      });
    }
  } catch (err) {
    log(`external search failed: ${(err as Error).message.slice(0, 60)}`);
  }

  if (candidates.length === 0) {
    console.log("No candidates found. Try `prof read <id>` to seed your library or refine your goal.");
    return;
  }

  // Rank: prefer high similarity, lightly boost library hits + low-citation surprises
  candidates.sort((a, b) => {
    const aBoost = a.source === "library-unread" ? 0.02 : 0;
    const bBoost = b.source === "library-unread" ? 0.02 : 0;
    return (b.similarity + bBoost) - (a.similarity + aBoost);
  });

  const top3 = candidates.slice(0, 3);
  const top = top3[0]!;

  // 3. LLM gives reasoning + decides "why now"
  log("model reasoning on next step");
  const { text: reasoning } = await complete({
    model: MODELS.cheap,
    system: "You explain why a specific next paper is the right move for a researcher's stated goal, in 2-4 sentences. Be honest. If the fit is weak, say so.",
    prompt: `Goal: "${goal}"

Candidate paper (the top pick):
- Title: ${top.title}
- Year: ${top.year ?? "?"}
- Citations: ${top.citations}
- Source: ${top.source}
- Abstract: ${top.abstract.slice(0, 1000)}

Already covered (recent reads):
${db().prepare<[], { title: string }>("SELECT title FROM papers ORDER BY ingested_at DESC LIMIT 5").all().map((r) => `- ${r.title}`).join("\n") || "(none yet)"}

In 2-4 sentences answer:
- Why this paper next, for THIS goal
- One concrete insight to look for when reading
- Prerequisite (only mention if real)`,
    maxTokens: 400,
    temperature: 0.4,
  });

  // 4. Persist as next trail step
  const nextPos = (steps.at(-1)?.position ?? 0) + 1;
  db()
    .prepare(
      "INSERT INTO trail_steps (trail_id, position, paper_id, why, status, added_at) VALUES (?, ?, ?, ?, 'queued', ?)",
    )
    .run(trail.id, nextPos, top.id, reasoning.trim(), nowEpoch());

  // 5. Render
  console.log(c.bold("next ▸ ") + top.title);
  console.log(c.dim(`        ${top.year ?? "?"} · ${top.citations} citations · ${top.source}`));
  if (top.arxivId) console.log(c.dim(`        ${c.cyan("https://arxiv.org/abs/" + top.arxivId)}`));
  else if (top.doi) console.log(c.dim(`        ${c.cyan("https://doi.org/" + top.doi)}`));
  console.log();
  console.log(reasoning.trim());
  console.log();

  if (top3.length > 1) {
    console.log(c.dim("alternates:"));
    for (const alt of top3.slice(1)) {
      console.log(c.dim(`  · ${alt.title} (${alt.year ?? "?"}, sim ${(alt.similarity * 100).toFixed(1)}%)`));
    }
    console.log();
  }

  const cmd = top.arxivId ? `prof read ${top.arxivId}` : top.doi ? `prof read ${top.doi}` : `prof read "${top.title.slice(0, 40)}..."`;
  console.log(c.dim("when ready: ") + c.bold(cmd));
  console.log(c.dim(`trail: ${trail.id} · step ${nextPos} queued · cost: $${(totalCostUsd() - costBefore).toFixed(4)}`));
  console.log();
}
