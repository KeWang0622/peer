#!/usr/bin/env node
/**
 * `prof` CLI entry point.
 *
 * Subcommands:
 *   prof read <arxiv-id|doi|url>
 *   prof map  <topic>
 *   prof daily   (stub for v1)
 *   prof ask <question>   (stub for v1)
 *   prof onboard --scholar <url>   (stub for v1)
 *
 * No subcommand → print help + version.
 */
import { profRead } from "../src/commands/read.js";
import { cmdMap } from "../src/commands/map.js";
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
  daily                        today's top arxiv papers   (v1.5)
  ask    <question>            query your library         (v1.5)
  onboard                      first-run setup            (v1.5)

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
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i += 2;
      } else {
        flags[key] = true;
        i++;
      }
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

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const { command, args, flags } = parseArgs(argv);

  if (flags.version) {
    console.log(`prof ${VERSION}`);
    return;
  }

  if (!command || flags.help) {
    printHelp();
    return;
  }

  const verbose = !!flags.verbose;
  let limit: number | undefined;
  if (typeof flags.limit === "string") {
    const n = parseInt(flags.limit, 10);
    if (!Number.isFinite(n) || n <= 0 || n > 500) {
      console.error(`Invalid --limit value: ${flags.limit} (must be 1..500)`);
      process.exit(1);
    }
    limit = n;
  }

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

    case "daily":
    case "ask":
    case "onboard":
      console.log(`'${command}' is coming in v1.5. For now, try:`);
      console.log("  prof map \"<topic>\"");
      console.log("  prof read <arxiv-id>");
      break;

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
