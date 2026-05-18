import { ensureDirs } from "../config/paths.js";
import { db } from "../db/client.js";
import { totalCostUsd } from "../lib/llm.js";

export interface HistoryOptions {
  days?: number;
  verbose?: boolean;
}

interface RecentPaper {
  title: string;
  year: number | null;
  source: string | null;
  citations_count: number;
  ingested_at: number;
}

export async function cmdHistory(opts: HistoryOptions = {}): Promise<void> {
  ensureDirs();
  const days = normalizeDays(opts.days);
  const since = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;

  const rows = db()
    .prepare<[number], RecentPaper>(
      `SELECT title, year, source, citations_count, ingested_at
       FROM papers
       WHERE ingested_at >= ?
       ORDER BY ingested_at DESC
       LIMIT 50`,
    )
    .all(since);

  console.log(`\n# Research history\n\nLast ${days} days\n`);

  if (rows.length === 0) {
    console.log("No papers read or imported in this window.\n");
  } else {
    rows.forEach((p, i) => {
      const date = new Date(p.ingested_at * 1000).toISOString().slice(0, 10);
      console.log(
        `${i + 1}. **${p.title}** (${p.year ?? "?"}) — ${date}` +
          `${p.source ? ` · ${p.source}` : ""} · ${p.citations_count} citations`,
      );
    });
    console.log("");
  }

  console.log(`Session LLM cost: $${totalCostUsd().toFixed(3)}\n`);
}

function normalizeDays(days: number | undefined): number {
  if (days == null || !Number.isFinite(days) || days <= 0) return 30;
  return Math.min(Math.floor(days), 3650);
}
