/**
 * The first thing users see when they type `lit` with no args.
 *
 * Professional TUI aesthetic — box-drawn header, contextual sections,
 * teaches usage without overwhelming, role-tailored next moves.
 */
import * as fs from "node:fs";
import { paths } from "../config/paths.js";
import { countPapers, db } from "../db/client.js";
import { c } from "./colors.js";
import { findRole, DEFAULT_ROLE, type Role, type RoleSpec } from "../agent/roles.js";

interface ProfileSummary {
  name?: string;
  role: Role;
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
    const fm = md.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
    if (!fm?.[1]) return null;
    const yaml = fm[1];
    const role = (yaml.match(/^role:\s*([a-z_]+)/im)?.[1]?.trim() as Role) ?? DEFAULT_ROLE;
    return {
      name: yaml.match(/^name:\s*"?([^"\n]+)"?/m)?.[1]?.trim(),
      role: findRole(role)?.id ?? DEFAULT_ROLE,
      primarySubfield: yaml.match(/^primary_subfield:\s*"?([^"\n]+)"?/m)?.[1]?.trim(),
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

// One-line description per command, used in role-tailored NEXT MOVES
const COMMAND_DESCRIPTIONS: Record<string, string> = {
  next: "what should I read next? (continues a trail)",
  brainstorm: "expand a half-formed idea (3 framings + 5 angles)",
  gap: "find sparse research intersections",
  daily: "today's top arxiv picks",
  read: "deep-read an arxiv id / DOI / URL",
  ask: "cited Q&A over your library",
  outline: "draft a paper outline + suggested citations",
  cite: "find citations + BibTeX for a claim",
  relwork: "draft a related-work section",
  collab: "find researchers active in a topic",
  history: "your reading trail + library stats",
  graph: "open knowledge graph in browser",
  compare: "side-by-side comparison of two papers",
  map: "5-minute field overview + reading list",
  onboard: "first-run setup (profile + seed library)",
};

function commandLine(cmd: string, brand: string): string {
  const desc = COMMAND_DESCRIPTIONS[cmd] ?? "";
  const padded = `${brand} ${cmd}`.padEnd(28);
  return "    " + c.accent(padded) + c.dim(desc);
}

export function printWelcome(brand: string = "lit"): void {
  const profile = readProfileSummary();
  const libCount = safeCount();
  const onboarded = !!profile || libCount > 0;
  const trails = onboarded ? activeTrails() : [];
  const role: RoleSpec = findRole(profile?.role ?? DEFAULT_ROLE) ?? findRole(DEFAULT_ROLE)!;

  console.log();
  console.log(c.primary("╭" + HR + "╮"));
  console.log(box(c.bold(brand) + c.dim("  v0.0.1-alpha.11  ") + c.italic("research is a journey")));
  if (onboarded) {
    const stats: string[] = [];
    if (profile?.name) stats.push(c.bold(profile.name));
    if (profile?.role) stats.push(c.dim(role.label.toLowerCase()));
    if (profile?.primarySubfield) stats.push(c.dim(profile.primarySubfield));
    stats.push(c.dim(`${libCount} paper${libCount === 1 ? "" : "s"}`));
    console.log(box(stats.join(c.dim("  ·  "))));
  }
  console.log(c.primary("╰" + HR + "╯"));
  console.log();

  // Active trails — visible journey state
  if (trails.length > 0) {
    console.log(c.bold("  ▌ ACTIVE TRAILS") + c.dim(`  — your reading journeys`));
    console.log();
    for (const t of trails) {
      const progress = `${t.done_steps}/${t.total_steps}`;
      console.log(`    ${c.accent("▸")} ${truncate(t.goal, 56)}   ${c.dim(progress + " steps")}`);
    }
    console.log();
    console.log(c.dim(`    ${c.bold(`${brand} next`)} to continue — picks the best next paper`));
    console.log();
  }

  // Quick start — contextual: pre-onboard vs post-onboard, AND role-tailored
  if (!onboarded) {
    console.log(c.bold("  ▌ START YOUR JOURNEY"));
    console.log();
    console.log(commandLine("onboard", brand) + c.dim("  (~3 min, ~$1.20)"));
    console.log(commandLine("map", brand) + c.dim("  (~$0.05)"));
    console.log(commandLine("brainstorm", brand) + c.dim("  (~$0.02)"));
    console.log();
  } else {
    console.log(c.bold("  ▌ NEXT MOVES") + c.dim(`  — calibrated for ${role.label.toLowerCase()}`));
    console.log();
    // Show top 5 commands for this role
    for (const cmd of role.emphasis.slice(0, 5)) {
      console.log(commandLine(cmd, brand));
    }
    console.log();
  }

  // The journey arc — cohesive product story
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
  console.log(
    c.dim("  ▌ ") +
      c.bold(`${brand} shell`) +
      c.dim("  interactive mode  ·  ") +
      c.bold(`${brand} --help`) +
      c.dim("  full reference  ·  ") +
      c.bold(`${brand} doctor`) +
      c.dim("  check setup"),
  );
  console.log();
}

function stripAnsiLen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
