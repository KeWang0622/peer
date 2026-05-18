/**
 * The first thing users see when they type `prof` with no args.
 */
import * as fs from "node:fs";
import { paths } from "../config/paths.js";
import { countPapers, db } from "../db/client.js";
import { c } from "./colors.js";

interface TrailRow {
  id: string;
  goal: string;
  total_steps: number;
  done_steps: number;
}

function activeTrails(): TrailRow[] {
  try {
    return db()
      .prepare<[], TrailRow>(
        `SELECT t.id, t.goal,
            (SELECT COUNT(*) FROM trail_steps s WHERE s.trail_id = t.id) as total_steps,
            (SELECT COUNT(*) FROM trail_steps s WHERE s.trail_id = t.id AND s.status='done') as done_steps
         FROM trails t
         WHERE t.status='active'
         ORDER BY t.created_at DESC
         LIMIT 3`,
      )
      .all();
  } catch {
    return [];
  }
}

interface ProfileSummary {
  name?: string;
  primarySubfield?: string;
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

const HEADER_WIDTH = 70;

function box(text: string, color: (s: string) => string): string {
  const inner = text.padEnd(HEADER_WIDTH - 4);
  return color("│ ") + inner + color(" │");
}

export function printWelcome(): void {
  const profile = readProfileSummary();
  const libCount = safeCount();
  const onboarded = !!profile || libCount > 0;

  console.log();
  console.log(c.primary("╭─ ") + c.bold("prof") + c.primary("  ") + c.italic("research is a journey") + c.primary(" ".repeat(35) + "─╮"));

  if (onboarded) {
    const line =
      (profile?.name ? `${c.bold(profile.name)} ` : "") +
      (profile?.primarySubfield ? c.dim("· " + profile.primarySubfield + " ") : "") +
      c.dim(`· ${libCount} paper${libCount === 1 ? "" : "s"} in library`);
    console.log(c.primary("│ ") + line + " ".repeat(Math.max(0, HEADER_WIDTH - stripAnsiLen(line) - 4)) + c.primary(" │"));
  }
  console.log(c.primary("╰" + "─".repeat(HEADER_WIDTH - 2) + "╯"));
  console.log();

  if (!onboarded) {
    console.log(c.bold("  start your journey:") + "\n");
    console.log("    " + c.accent("prof onboard") + c.dim("                    tell prof about your work (3 min)"));
    console.log("    " + c.accent('prof map "<topic>"') + c.dim("              jump straight in — map a field in 5 min"));
    console.log("    " + c.accent("prof brainstorm \"<idea>\"") + c.dim("        expand a vague idea"));
  } else {
    const trails = activeTrails();
    if (trails.length > 0) {
      console.log(c.bold("  your active trails:") + "\n");
      for (const t of trails) {
        const progress = `${t.done_steps}/${t.total_steps}`;
        console.log("    " + c.accent("▸ ") + c.bold(truncate(t.goal, 50)) + c.dim(`   ${progress} steps`));
      }
      console.log("    " + c.dim("    ") + c.bold("prof next") + c.dim(" to continue · ") + c.bold("prof read <id>") + c.dim(" to mark done"));
      console.log();
    }

    console.log(c.bold("  continue your journey:") + "\n");
    console.log("    " + c.accent("prof daily") + c.dim("                      today's top arxiv picks"));
    console.log("    " + c.accent("prof read <arxiv-id>") + c.dim("            deep-read a paper"));
    console.log("    " + c.accent('prof ask "<question>"') + c.dim("           cited Q&A over your library"));
    console.log("    " + c.accent('prof next "<goal>"') + c.dim("              what to read next, toward a goal"));
    console.log("    " + c.accent("prof graph") + c.dim("                      open your knowledge graph"));
    console.log("    " + c.accent("prof journal") + c.dim("                    write a journey note"));
  }

  console.log();
  console.log(c.dim("  16 commands across 6 stages of the journey:"));
  console.log(c.dim("  ") + c.primary("orient") + c.dim(" · ") + c.primary("think") + c.dim(" · ") + c.primary("read") + c.dim(" · ") + c.primary("publish") + c.dim(" · ") + c.primary("share") + c.dim(" · ") + c.primary("reflect"));
  console.log();
  console.log(c.dim("  ") + c.bold("prof --help") + c.dim(" for everything · ") + c.bold("prof doctor") + c.dim(" to check your setup"));
  console.log();
}

function stripAnsiLen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
