/**
 * First-run onboarding for `prof shell`.
 *
 * Deterministic, not LLM-driven. When the user has an empty library and
 * no profile.md, we walk them through a 4-question scripted flow:
 *
 *   1. What should I call you?
 *   2. What's your research area?
 *   3. Want to seed your library? (arxiv IDs or skip)
 *   4. Want me to map the field right now? (yes/no)
 *
 * Then hand off to the regular agent loop.
 */
import * as fs from "node:fs";
import * as readline from "node:readline";
import { paths, ensureDirs } from "../config/paths.js";
import { countPapers } from "../db/client.js";
import { c } from "./colors.js";

export function isFirstRun(): boolean {
  try {
    return countPapers() === 0 && !fs.existsSync(paths.profile());
  } catch {
    return true;
  }
}

async function ask(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(c.bold(prompt) + " ", (answer) => resolve(answer.trim()));
  });
}

export interface OnboardOutcome {
  name?: string;
  area?: string;
  seedIds: string[];
  wantsMap: boolean;
  skipped: boolean;
}

export async function runFirstRun(): Promise<OnboardOutcome> {
  console.log();
  console.log(c.primary("─".repeat(70)));
  console.log("  " + c.bold("welcome to prof") + c.dim(" — 60-second setup"));
  console.log();
  console.log("  " + c.dim("type 'skip' at any step to jump into the shell unguided"));
  console.log(c.primary("─".repeat(70)));
  console.log();

  ensureDirs();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    const name = await ask(rl, "What should I call you?  ▸");
    if (name.toLowerCase() === "skip" || !name) {
      console.log();
      console.log(c.dim("(skipping onboard — talk to me whenever you're ready)"));
      console.log();
      return { skipped: true, seedIds: [], wantsMap: false };
    }

    const area = await ask(rl, `Nice to meet you, ${name}. What's your research area?  ▸`);
    if (!area || area.toLowerCase() === "skip") {
      writeMinimalProfile(name, null);
      return { name, skipped: false, seedIds: [], wantsMap: false };
    }

    const seedAnswer = await ask(
      rl,
      `Want to seed your library? Paste arxiv IDs (comma-separated), or 'skip'.  ▸`,
    );
    const seedIds = parseSeedIds(seedAnswer);

    const mapAnswer = await ask(
      rl,
      `Last one: map the field "${area}" right now? (y/n, takes ~90s, costs ~$0.05)  ▸`,
    );
    const wantsMap = /^y(es)?$/i.test(mapAnswer);

    writeMinimalProfile(name, area);

    console.log();
    console.log(c.primary("─".repeat(70)));
    console.log("  " + c.dim("profile saved to ") + paths.profile());
    if (seedIds.length > 0) console.log("  " + c.dim(`seeding ${seedIds.length} paper${seedIds.length === 1 ? "" : "s"}…`));
    if (wantsMap) console.log("  " + c.dim(`mapping "${area}"…`));
    if (!seedIds.length && !wantsMap) console.log("  " + c.dim("no actions queued · type a command or chat naturally below"));
    console.log(c.primary("─".repeat(70)));
    console.log();

    return { name, area, seedIds, wantsMap, skipped: false };
  } finally {
    rl.close();
  }
}

function parseSeedIds(input: string): string[] {
  if (!input || /^skip$/i.test(input.trim())) return [];
  return input
    .split(/[,\s]+/)
    .map((s) => s.trim().replace(/^arxiv:/i, "").replace(/v\d+$/, ""))
    .filter((s) => /^\d{4}\.\d{4,5}$/.test(s) || /^[a-z\-]+\/\d{7}$/.test(s));
}

function writeMinimalProfile(name: string, area: string | null): void {
  const now = new Date().toISOString().slice(0, 10);
  const md = `---
name: "${name.replace(/"/g, '\\"')}"
primary_subfield: ${area ? `"${area.replace(/"/g, '\\"')}"` : "null"}
onboarded_at: ${now}
---

# ${name}'s research profile

Primary subfield: ${area ?? "(not specified)"}

This file is editable. \`prof\` reads it on every startup.
`;
  fs.writeFileSync(paths.profile(), md);
}

/** Execute the post-onboarding side effects (seed reads + optional map). */
export async function executeOutcome(outcome: OnboardOutcome, verbose: boolean): Promise<void> {
  if (outcome.skipped) return;

  if (outcome.seedIds.length > 0) {
    const { profRead } = await import("../commands/read.js");
    for (const id of outcome.seedIds.slice(0, 8)) {
      try {
        console.log(c.dim(`  ▸ reading arxiv:${id}…`));
        const r = await profRead(id, { verbose });
        console.log(c.ok(`  ✓ ${r.title.slice(0, 60)}${r.title.length > 60 ? "…" : ""}`));
      } catch (err) {
        console.log(c.bad(`  ✗ ${id}: ${(err as Error).message.slice(0, 70)}`));
      }
    }
    console.log();
  }

  if (outcome.wantsMap && outcome.area) {
    const { cmdMap } = await import("../commands/map.js");
    try {
      await cmdMap(outcome.area, { verbose });
    } catch (err) {
      console.log(c.bad(`  map failed: ${(err as Error).message}`));
    }
  }

  console.log();
  console.log(c.dim("  Now you can talk to me naturally. Try things like:"));
  console.log(c.dim("    · what should I read next?"));
  console.log(c.dim("    · find me citations for: <claim>"));
  console.log(c.dim("    · save my reading queue at /tmp/queue.md"));
  console.log();
}
