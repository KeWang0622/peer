/**
 * peer — pi-agent-core extension entry point.
 *
 * Registered when a user runs `pi install @KeWang0622/peer`.
 * Adds:
 *   - slash command /read
 *   - slash command /map
 *   - system prompt fragment describing research-native behaviors
 *
 * v0.0.1-alpha: minimal registration. v1.0 will register full AgentTool[] set.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Reading system prompt fragment from disk
function loadSystemPrompt(): string {
  const candidates = [
    path.join(__dirname, "system-prompt.md"),
    path.join(__dirname, "..", "src", "system-prompt.md"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf-8");
  }
  return "";
}

// Pi extension API surface (loose-typed for forward compat)
interface ExtensionAPI {
  registerCommand?(name: string, options: {
    description?: string;
    handler: (args: string[], ctx: unknown) => Promise<void> | void;
  }): void;
  on?(event: string, handler: (e: unknown) => Promise<unknown> | unknown): void;
}

export default function profExtension(pi: ExtensionAPI): void {
  const systemFragment = loadSystemPrompt();

  // Inject our researcher persona into the system prompt
  pi.on?.("before_agent_start", () => {
    if (!systemFragment) return;
    return {
      message: {
        customType: "peer-system-fragment",
        content: systemFragment,
        display: false,
      },
    };
  });

  // /read slash command
  pi.registerCommand?.("read", {
    description: "Deep-read a paper by arxiv id / DOI / URL",
    handler: async (args) => {
      const { profRead } = await import("./commands/read.js");
      const input = args.join(" ").trim();
      if (!input) {
        console.error('Usage: /read <arxiv-id|doi|url>');
        return;
      }
      const result = await profRead(input, { verbose: true });
      console.log(`✓ ${result.title}`);
      console.log(`  → ${result.notePath}`);
      console.log(`  cost: $${result.cost.toFixed(4)}`);
    },
  });

  // /map slash command
  pi.registerCommand?.("map", {
    description: "Map a research field — produces overview + reading order",
    handler: async (args) => {
      const { cmdMap } = await import("./commands/map.js");
      const topic = args.join(" ").trim();
      if (!topic) {
        console.error('Usage: /map "<topic>"');
        return;
      }
      await cmdMap(topic, { verbose: true });
    },
  });
}
