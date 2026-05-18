#!/usr/bin/env node
/**
 * `prof` CLI entry point.
 *
 * Subcommands:
 *   prof read <arxiv-id|doi|url>
 *   prof map  <topic>
 *   prof doctor
 *   prof daily
 *   prof ask <question>   (stub for v1)
 *   prof onboard --scholar <url>   (stub for v1)
 *
 * No subcommand → print help + version.
 */
import "../src/lib/process-warnings.js";
import { profRead } from "../src/commands/read.js";
import { cmdMap } from "../src/commands/map.js";
import { cmdDoctor } from "../src/commands/doctor.js";
import { paths } from "../src/config/paths.js";
import { countPapers } from "../src/db/client.js";
import { totalCostUsd } from "../src/lib/llm.js";

const VERSION = "0.0.1-alpha.0";

function printHelp(): void {
  console.log(`
prof v${VERSION}  ·  your research operating system

USAGE
  prof <command> [args]

COMMANDS
  read   <arxiv-id|doi|url>   deep-read a paper, write a note
  map    <topic>               map a research field (the viral demo)
  doctor                       run preflight checks
  ask    <question>            query your library (RAG over your notes)
  daily                        today's top arxiv papers
  onboard                      first-run setup (profile + seed library)

OPTIONS
  --verbose      detailed progress output
  --limit <n>    paper limit for map / search
  --help, -h     this help
  --version, -v  print version

ENV
  ANTHROPIC_API_KEY            required, the brain
  OPENAI_API_KEY               required for map command (embeddings)
  SEMANTIC_SCHOLAR_API_KEY     optional, higher rate limits
  PROF_HOME                    override ~/.prof location

NOTES
  All data is local at ${paths.home()}
  Apache 2.0, BYOK. https://github.com/kewang/prof
	`);
}

const VALUE_FLAGS = new Set(["limit"]);
const COMMANDS = new Set(["read", "map", "doctor", "daily", "ask", "onboard"]);
const GLOBAL_FLAGS = new Set(["help", "version"]);
const ALL_FLAGS = new Set(["help", "version", "verbose", "limit"]);
const COMMAND_FLAGS: Record<string, Set<string>> = {
  read: new Set(["help", "version", "verbose"]),
  map: new Set(["help", "version", "verbose", "limit"]),
  doctor: new Set(["help", "version", "verbose"]),
  daily: new Set(["help", "version", "verbose"]),
  ask: new Set(["help", "version", "verbose"]),
  onboard: new Set(["help", "version", "verbose"]),
};

function parseArgs(argv: string[]): { command: string | null; args: string[]; flags: Record<string, string | boolean> } {
  const flags: Record<string, string | boolean> = {};
  const args: string[] = [];
  let command: string | null = null;
  let i = 0;
  while (i < argv.length) {
    const a = argv[i]!;
    if (a === "--help" || a === "-h") {
      flags.help = true;
      i++;
    } else if (a === "--version" || a === "-v") {
      flags.version = true;
      i++;
    } else if (a.startsWith("--")) {
      const raw = a.slice(2);
      const eq = raw.indexOf("=");
      const key = eq === -1 ? raw : raw.slice(0, eq);
      if (!key) {
        i++;
        continue;
      }
      if (eq !== -1) {
        flags[key] = raw.slice(eq + 1);
        i++;
      } else if (VALUE_FLAGS.has(key)) {
        const next = argv[i + 1];
        if (next && !next.startsWith("-")) {
          flags[key] = next;
          i += 2;
        } else {
          flags[key] = true;
          i++;
        }
      } else {
        flags[key] = true;
        i++;
      }
    } else if (a.startsWith("-") && a !== "-") {
      flags[a.slice(1)] = true;
      i++;
    } else if (!command) {
      command = a;
      i++;
    } else {
      args.push(a);
      i++;
    }
  }
  return { command, args, flags };
}

function validateCommand(command: string | null): void {
  if (!command || COMMANDS.has(command)) return;

  const suggestion = suggest(command, [...COMMANDS]);
  console.error(`Unknown command: ${command}${suggestion ? `. Did you mean '${suggestion}'?` : ""}`);
  printHelp();
  process.exit(1);
}

function validateFlags(command: string | null, flags: Record<string, string | boolean>): void {
  for (const key of Object.keys(flags)) {
    if (!ALL_FLAGS.has(key)) {
      printFlagError(key, [...ALL_FLAGS]);
    }
  }

  const allowed = !command ? GLOBAL_FLAGS : COMMANDS.has(command) ? COMMAND_FLAGS[command]! : ALL_FLAGS;
  for (const key of Object.keys(flags)) {
    if (!allowed.has(key)) {
      printFlagError(key, [...allowed]);
    }
  }
}

function printFlagError(key: string, candidates: string[]): never {
  const flag = formatFlag(key);
  const suggestion = suggest(key, candidates);
  console.error(`Unknown flag: ${flag}${suggestion ? `. Did you mean ${formatFlag(suggestion)}?` : ""}`);
  process.exit(1);
}

function formatFlag(key: string): string {
  return key.length === 1 ? `-${key}` : `--${key}`;
}

function suggest(input: string, candidates: string[]): string | null {
  let best: { value: string; distance: number } | null = null;
  for (const candidate of candidates) {
    const distance = levenshtein(input, candidate);
    if (!best || distance < best.distance) {
      best = { value: candidate, distance };
    }
  }
  return best && best.distance <= 3 ? best.value : null;
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = Array.from({ length: b.length + 1 }, () => 0);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1]! + 1,
        prev[j]! + 1,
        prev[j - 1]! + cost,
      );
    }
    for (let j = 0; j <= b.length; j++) {
      prev[j] = curr[j]!;
    }
  }

  return prev[b.length]!;
}

function parseLimit(value: string | boolean | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    console.error("Missing value for --limit");
    process.exit(1);
  }

  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0 || n > 500) {
    console.error(`Invalid --limit value: ${value} (must be 1..500)`);
    process.exit(1);
  }
  return n;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const { command, args, flags } = parseArgs(argv);

  validateFlags(command, flags);
  validateCommand(command);

  if (flags.version) {
    console.log(`prof ${VERSION}`);
    return;
  }

  if (!command || flags.help) {
    printHelp();
    return;
  }

  const verbose = !!flags.verbose;
  const limit = parseLimit(flags.limit);

  switch (command) {
    case "read": {
      const input = args[0];
      if (!input) {
        console.error("Usage: prof read <arxiv-id|doi|url>");
        process.exit(1);
      }
      const result = await profRead(input, { verbose });
      console.log(`\n✓ Read: ${result.title}`);
      console.log(`  → ${result.notePath}`);
      console.log(`  Cost: $${result.cost.toFixed(4)}`);
      console.log(`  Library now: ${countPapers()} papers, total spent: $${totalCostUsd().toFixed(3)}\n`);
      break;
    }

    case "map": {
      const topic = args.join(" ").trim();
      if (!topic) {
        console.error('Usage: prof map "<topic>"');
        process.exit(1);
      }
      await cmdMap(topic, { limit, verbose });
      break;
    }

    case "doctor": {
      const result = await cmdDoctor();
      if (result.failedRequired > 0) {
        process.exit(1);
      }
      break;
    }

    case "ask": {
      const question = args.join(" ").trim();
      if (!question) {
        console.error('Usage: prof ask "<question>"');
        process.exit(1);
      }
      const { cmdAsk } = await import("../src/commands/ask.js");
      await cmdAsk(question, { verbose });
      break;
    }

    case "daily": {
      const { cmdDaily } = await import("../src/commands/daily.js");
      await cmdDaily({ verbose });
      break;
    }

    case "onboard": {
      const { cmdOnboard } = await import("../src/commands/onboard.js");
      await cmdOnboard({ verbose });
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

main().catch((err: unknown) => {
  const e = err as Error;
  console.error(`\nprof: ${e.message}`);
  if (process.env.PROF_DEBUG) {
    console.error(e.stack);
  } else {
    console.error("(set PROF_DEBUG=1 for stack trace)");
  }
  process.exit(1);
});
