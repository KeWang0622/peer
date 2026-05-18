/**
 * The first thing users see when they type `prof` with no args.
 *
 * Professional TUI aesthetic — box-drawn header, contextual sections,
 * teaches usage without overwhelming.
 */
import * as fs from "node:fs";
import { paths } from "../config/paths.js";
import { countPapers, db } from "../db/client.js";
import { c } from "./colors.js";

interface ProfileSummary {
  name?: string;
  primarySubfield?: string;
}

interface TrailRow {
  id: string;
  goal: string;
  total_steps: number;
  done_steps: number;
}

function readProfileSummary(): ProfileSummary | null {
  const p = paths.profile();
  if (!fs.existsSync(p)) return null;
  try {
    const md = fs.readFileSync(p, "utf-8");
    const fm = md.match(/^---\n([\s\S]*?)\n---/);
    if (!fm?.[1]) return null;
    return {
      name: fm[1].match(/name:\s*"?([^"\n]+)"?/)?.[1]?.trim(),
      primarySubfield: fm[1].match(/primary_subfield:\s*"?([^"\n]+)"?/)?.[1]?.trim(),
    };
  } catch {
    return null;
  }
}

function safeCount(): number {
  try {
    return countPapers();
  } catch {
    return 0;
  }
}

function activeTrails(): TrailRow[] {
  try {
    return db()
      .prepare<[], TrailRow>(
        `SELECT t.id, t.goal,
            (SELECT COUNT(*) FROM trail_steps s WHERE s.trail_id = t.id) as total_steps,
            (SELECT COUNT(*) FROM trail_steps s WHERE s.trail_id = t.id AND s.status='done') as done_steps
         FROM trails t WHERE t.status='active' ORDER BY t.created_at DESC LIMIT 3`,
      )
      .all();
  } catch {
    return [];
  }
}

const W = 72;
const HR = "─".repeat(W - 2);

function pad(s: string): string {
  const len = stripAnsiLen(s);
  return s + " ".repeat(Math.max(0, W - 4 - len));
}

function box(line: string): string {
  return c.primary("│ ") + pad(line) + c.primary(" │");
}

export function printWelcome(): void {
  const profile = readProfileSummary();
  const libCount = safeCount();
  const onboarded = !!profile || libCount > 0;
  const trails = onboarded ? activeTrails() : [];

  console.log();
  console.log(c.primary("╭" + HR + "╮"));
  console.log(box(c.bold("prof") + c.dim("  v0.0.1-alpha.4  ") + c.italic("research is a journey")));
  if (onboarded) {
    const stats: string[] = [];
    if (profile?.name) stats.push(c.bold(profile.name));
    if (profile?.primarySubfield) stats.push(c.dim(profile.primarySubfield));
    stats.push(c.dim(`${libCount} paper${libCount === 1 ? "" : "s"}`));
    console.log(box(stats.join(c.dim("  ·  "))));
  }
  console.log(c.primary("╰" + HR + "╯"));
  console.log();

  // Active trails section — only when present, teaches that journey persists
  if (trails.length > 0) {
    console.log(c.bold("  ▌ ACTIVE TRAILS") + c.dim(`  — your reading journeys`));
    console.log();
    for (const t of trails) {
      const progress = `${t.done_steps}/${t.total_steps}`;
      console.log(`    ${c.accent("▸")} ${truncate(t.goal, 56)}   ${c.dim(progress + " steps")}`);
    }
    console.log();
    console.log(c.dim(`    ${c.bold("prof next")} to continue — picks the best next paper for the active trail`));
    console.log();
  }

  // Quick start: contextual to where you are in the journey
  if (!onboarded) {
    console.log(c.bold("  ▌ START YOUR JOURNEY"));
    console.log();
    console.log("    " + c.accent("prof onboard") + "                tell prof about your work " + c.dim("(takes ~3 min, ~$1.20)"));
    console.log("    " + c.accent('prof map "<topic>"') + "          jump in: 5-min field overview " + c.dim("(~$0.05)"));
    console.log("    " + c.accent("prof brainstorm") + "             half-formed idea? expand it " + c.dim("(~$0.02)"));
    console.log();
  } else {
    console.log(c.bold("  ▌ NEXT MOVES"));
    console.log();
    console.log("    " + c.accent("prof daily") + "                  today's top arxiv picks " + c.dim("(~$0.01)"));
    console.log("    " + c.accent("prof read <arxiv-id>") + "        deep-read a paper " + c.dim("(~$0.01)"));
    console.log("    " + c.accent('prof ask "<question>"') + "       cited Q&A over your library " + c.dim("(~$0.01)"));
    console.log("    " + c.accent('prof next "<goal>"') + "          what should I read next?");
    console.log("    " + c.accent("prof graph") + "                  open knowledge graph in browser");
    console.log();
  }

  // The journey map — the cohesive product story
  console.log(c.bold("  ▌ THE JOURNEY") + c.dim("  — 17 commands across 6 stages"));
  console.log();
  console.log(
    "    " +
      c.primary("orient") +
      c.dim(" → ") +
      c.primary("think") +
      c.dim(" → ") +
      c.primary("read") +
      c.dim(" → ") +
      c.primary("publish") +
      c.dim(" → ") +
      c.primary("share") +
      c.dim(" → ") +
      c.primary("reflect"),
  );
  console.log();

  // Footer
  console.log(c.dim("  ▌ ") + c.bold("prof shell") + c.dim("  interactive mode  ·  ") + c.bold("prof --help") + c.dim("  full reference  ·  ") + c.bold("prof doctor") + c.dim("  check setup"));
  console.log();
}

function stripAnsiLen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
