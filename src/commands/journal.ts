/**
 * `prof journal` — your research diary.
 *
 * Usage:
 *   prof journal                      → opens an editor for today's entry
 *   prof journal "<text>"             → appends a one-liner with timestamp
 *   prof journal --read               → prints last 14 days of entries
 *   prof journal --read --days 30     → custom window
 *
 * Storage: ~/.prof/notes/journal.md (Obsidian-compatible markdown).
 * Each entry is preceded by a `## YYYY-MM-DD HH:MM` heading for queryability.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { paths, ensureDirs } from "../config/paths.js";

function journalPath(): string {
  return path.join(paths.notes(), "journal.md");
}

function tsHeading(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ensureJournal(): string {
  ensureDirs();
  const p = journalPath();
  if (!fs.existsSync(p)) {
    fs.writeFileSync(
      p,
      `# prof — research journal

Research is a journey. This file is your trail.

`,
    );
  }
  return p;
}

export async function cmdJournal(rawArgs: string[], opts: { read?: boolean; days?: number; verbose?: boolean } = {}): Promise<void> {
  const p = ensureJournal();

  if (opts.read) {
    const days = opts.days ?? 14;
    printRecentEntries(p, days);
    return;
  }

  const inlineText = rawArgs.join(" ").trim();

  if (inlineText) {
    const entry = `\n## ${tsHeading()}\n\n${inlineText}\n`;
    fs.appendFileSync(p, entry);
    console.log(`✓ Added to ${p}`);
    return;
  }

  // Open editor for interactive entry
  const editor = process.env.VISUAL ?? process.env.EDITOR ?? "vim";
  const tmpFile = path.join(paths.home(), `.journal-draft-${Date.now()}.md`);
  fs.writeFileSync(tmpFile, `<!-- write your entry below. close to save, leave empty to cancel. -->\n\n`);

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(editor, [tmpFile], { stdio: "inherit" });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`editor exited with code ${code}`));
    });
    proc.on("error", reject);
  });

  const content = fs.readFileSync(tmpFile, "utf-8")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
  fs.unlinkSync(tmpFile);

  if (!content) {
    console.log("(empty entry, nothing saved)");
    return;
  }

  const entry = `\n## ${tsHeading()}\n\n${content}\n`;
  fs.appendFileSync(p, entry);
  console.log(`✓ Saved entry (${content.length} chars) to ${p}`);
}

function printRecentEntries(p: string, days: number): void {
  if (!fs.existsSync(p)) {
    console.log("No journal entries yet. Try: prof journal \"first thought of the day\"");
    return;
  }
  const md = fs.readFileSync(p, "utf-8");

  // Split into entries by ## heading
  const sections = md.split(/(?=^## \d{4}-\d{2}-\d{2})/m);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const recent = sections.filter((s) => {
    const m = s.match(/^## (\d{4})-(\d{2})-(\d{2})/);
    if (!m) return false;
    const entryDate = new Date(parseInt(m[1]!), parseInt(m[2]!) - 1, parseInt(m[3]!));
    return entryDate >= cutoff;
  });

  if (recent.length === 0) {
    console.log(`No entries in the last ${days} days.`);
    return;
  }

  console.log(`\n# Journal — last ${days} days (${recent.length} entries)\n`);
  for (const s of recent) {
    console.log(s.trim());
    console.log();
  }
}
