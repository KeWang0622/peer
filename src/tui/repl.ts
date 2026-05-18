/**
 * Interactive REPL — `prof shell`.
 *
 * Drops the user into a colored prompt. They type subcommands without the
 * 'prof' prefix and see streamed output. The same handlers as the CLI
 * binary, just hosted in-process.
 */
import * as readline from "node:readline";
import { c } from "./colors.js";
import { printWelcome } from "./welcome.js";
import { countPapers } from "../db/client.js";
import { totalCostUsd } from "../lib/llm.js";

interface CommandTable {
  [name: string]: {
    summary: string;
    needsArgs?: boolean;
    run: (args: string[]) => Promise<void>;
  };
}

async function buildCommands(verbose: boolean): Promise<CommandTable> {
  const { profRead } = await import("../commands/read.js");
  const { cmdMap } = await import("../commands/map.js");
  const { cmdDoctor } = await import("../commands/doctor.js");
  const { cmdAsk } = await import("../commands/ask.js");
  const { cmdDaily } = await import("../commands/daily.js");
  const { cmdOnboard } = await import("../commands/onboard.js");
  const { cmdGraph } = await import("../commands/graph.js");
  const { cmdCite } = await import("../commands/cite.js");
  const { cmdGap } = await import("../commands/gap.js");
  const { cmdJournal } = await import("../commands/journal.js");
  const { cmdCollab } = await import("../commands/collab.js");
  const { cmdHistory } = await import("../commands/history.js");
  const { cmdBrainstorm } = await import("../commands/brainstorm.js");
  const { cmdRelwork } = await import("../commands/relwork.js");
  const { cmdOutline } = await import("../commands/outline.js");
  const { cmdCompare } = await import("../commands/compare.js");
  const { cmdNext } = await import("../commands/next.js");

  const usage = (name: string, hint: string) => () => {
    console.error(`usage: ${name} ${hint}`);
  };

  return {
    onboard: { summary: "first-run setup", run: async () => cmdOnboard({ verbose }) },
    daily: { summary: "today's top arxiv picks", run: async () => cmdDaily({ verbose }) },
    read: {
      summary: "deep-read a paper",
      needsArgs: true,
      run: async (a) => {
        if (a.length === 0) return usage("read", "<arxiv-id|doi|url>")();
        await profRead(a[0]!, { verbose });
        console.log(c.dim(`(library: ${countPapers()} papers · session: $${totalCostUsd().toFixed(4)})`));
      },
    },
    map: {
      summary: "map a field",
      needsArgs: true,
      run: async (a) => {
        const t = a.join(" ").trim();
        if (!t) return usage("map", '"<topic>"')();
        await cmdMap(t, { verbose });
      },
    },
    ask: {
      summary: "cited Q&A over your library",
      needsArgs: true,
      run: async (a) => {
        const q = a.join(" ").trim();
        if (!q) return usage("ask", '"<question>"')();
        await cmdAsk(q, { verbose });
      },
    },
    cite: {
      summary: "find citations + BibTeX",
      needsArgs: true,
      run: async (a) => {
        const claim = a.join(" ").trim();
        if (!claim) return usage("cite", '"<claim>"')();
        await cmdCite(claim, { verbose });
      },
    },
    relwork: {
      summary: "draft a related-work section",
      needsArgs: true,
      run: async (a) => {
        const t = a.join(" ").trim();
        if (!t) return usage("relwork", '"<topic>"')();
        await cmdRelwork(t, { verbose });
      },
    },
    outline: {
      summary: "paper outline with citations",
      needsArgs: true,
      run: async (a) => {
        const t = a.join(" ").trim();
        if (!t) return usage("outline", '"<topic>"')();
        await cmdOutline(t, { verbose });
      },
    },
    brainstorm: {
      summary: "expand a vague idea",
      needsArgs: true,
      run: async (a) => {
        const s = a.join(" ").trim();
        if (!s) return usage("brainstorm", '"<idea>"')();
        await cmdBrainstorm(s, { verbose });
      },
    },
    gap: {
      summary: "find sparse intersections",
      needsArgs: true,
      run: async (a) => {
        const t = a.join(" ").trim();
        if (!t) return usage("gap", '"<X> and <Y>"')();
        await cmdGap(t, { verbose });
      },
    },
    next: {
      summary: "next paper to read for a goal",
      run: async (a) => {
        const g = a.join(" ").trim() || null;
        await cmdNext(g, { verbose });
      },
    },
    compare: {
      summary: "side-by-side paper comparison",
      needsArgs: true,
      run: async (a) => {
        if (a.length < 2) return usage("compare", "<id1> <id2>")();
        await cmdCompare(a[0]!, a[1]!, { verbose });
      },
    },
    collab: {
      summary: "find collaborators",
      needsArgs: true,
      run: async (a) => {
        const t = a.join(" ").trim();
        if (!t) return usage("collab", '"<topic|author>"')();
        await cmdCollab(t, { verbose });
      },
    },
    graph: { summary: "open knowledge graph", run: async () => cmdGraph({ verbose }) },
    journal: {
      summary: "research diary",
      run: async (a) => {
        const read = a[0] === "--read";
        const rest = read ? a.slice(1) : a;
        await cmdJournal(rest, { read, verbose });
      },
    },
    history: { summary: "reading trail + stats", run: async () => cmdHistory({ verbose }) },
    doctor: { summary: "preflight checks", run: async () => { await cmdDoctor(); } },
  };
}

function tokenize(line: string): string[] {
  // Simple shell-like tokenizer: respects "quoted strings"
  const tokens: string[] = [];
  let i = 0;
  while (i < line.length) {
    while (i < line.length && line[i] === " ") i++;
    if (i >= line.length) break;
    if (line[i] === '"' || line[i] === "'") {
      const quote = line[i]!;
      i++;
      let buf = "";
      while (i < line.length && line[i] !== quote) {
        buf += line[i];
        i++;
      }
      if (i < line.length) i++; // skip closing quote
      tokens.push(buf);
    } else {
      let buf = "";
      while (i < line.length && line[i] !== " ") {
        buf += line[i];
        i++;
      }
      tokens.push(buf);
    }
  }
  return tokens;
}

export async function cmdShell(opts: { verbose?: boolean } = {}): Promise<void> {
  const verbose = !!opts.verbose;

  printWelcome();

  const commands = await buildCommands(verbose);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    completer: (line: string) => {
      const lower = line.toLowerCase();
      const hits = Object.keys(commands).filter((c) => c.startsWith(lower));
      return [hits.length ? hits : Object.keys(commands), line] as [string[], string];
    },
    historySize: 200,
  });

  rl.setPrompt(c.primary("prof ❯ "));

  rl.on("close", () => {
    console.log();
    console.log(c.dim("research is a journey · session $") + c.dim(totalCostUsd().toFixed(4)));
    process.exit(0);
  });

  function showHelp() {
    console.log();
    console.log(c.bold("commands:"));
    for (const [name, def] of Object.entries(commands)) {
      console.log(`  ${c.accent(name.padEnd(12))} ${c.dim(def.summary)}`);
    }
    console.log(`  ${c.accent("help".padEnd(12))} ${c.dim("show this list")}`);
    console.log(`  ${c.accent("clear".padEnd(12))} ${c.dim("clear the screen")}`);
    console.log(`  ${c.accent("exit".padEnd(12))} ${c.dim("leave the shell (Ctrl+D)")}`);
    console.log();
  }

  // Initial hint
  console.log(c.dim("type ") + c.bold("help") + c.dim(" for commands · ") + c.bold("Ctrl+D") + c.dim(" to exit"));
  console.log();

  rl.prompt();

  rl.on("line", async (raw) => {
    const line = raw.trim();
    if (!line) {
      rl.prompt();
      return;
    }

    const tokens = tokenize(line);
    const name = tokens[0]!.toLowerCase();
    const args = tokens.slice(1);

    try {
      if (name === "exit" || name === "quit") {
        rl.close();
        return;
      }
      if (name === "clear" || name === "cls") {
        console.clear();
        rl.prompt();
        return;
      }
      if (name === "help" || name === "?" || name === "h") {
        showHelp();
        rl.prompt();
        return;
      }

      const cmd = commands[name];
      if (!cmd) {
        const suggestion = suggest(name, Object.keys(commands));
        console.log(c.bad(`unknown command: ${name}`) + (suggestion ? c.dim(`  (did you mean '${suggestion}'?)`) : ""));
        rl.prompt();
        return;
      }

      // Suspend prompt during the command (which may stream output)
      rl.pause();
      await cmd.run(args);
      rl.resume();
    } catch (err) {
      const e = err as Error;
      console.log(c.bad(`error: ${e.message}`));
    } finally {
      rl.prompt();
    }
  });
}

function suggest(input: string, candidates: string[]): string | null {
  let best: { v: string; d: number } | null = null;
  for (const c of candidates) {
    const d = lev(input, c);
    if (!best || d < best.d) best = { v: c, d };
  }
  return best && best.d <= 3 ? best.v : null;
}

function lev(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = Array.from({ length: b.length + 1 }, () => 0);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]!;
  }
  return prev[b.length]!;
}
