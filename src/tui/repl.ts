/**
 * Natural-language REPL for `prof shell`.
 *
 * This shell is a real pi-agent-core Agent: user text goes straight to the
 * model, which decides when to call prof's research tools.
 */
import * as readline from "node:readline";
import type { AgentEvent, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { AssistantMessageEvent, ImageContent, TextContent } from "@earendil-works/pi-ai";
import { buildProfAgent } from "../agent/agent.js";
import { totalCostUsd } from "../lib/llm.js";
import { c } from "./colors.js";
import { printWelcome } from "./welcome.js";

const META_COMMANDS = ["help", "clear", "reset", "exit", "quit"] as const;

export async function cmdShell(opts: { verbose?: boolean } = {}): Promise<void> {
  printWelcome("lit");

  // Deterministic first-run onboarding (no library, no profile → 60-sec setup)
  const { isFirstRun, runFirstRun, executeOutcome } = await import("./onboard-firstrun.js");
  if (isFirstRun()) {
    const outcome = await runFirstRun();
    if (!outcome.skipped) {
      await executeOutcome(outcome, !!opts.verbose);
    }
  }

  const agent = buildProfAgent({ verbose: !!opts.verbose });
  const renderer = createEventRenderer();
  let awaitingAgent = false;
  let exiting = false;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    completer: (line: string) => {
      const lower = line.toLowerCase();
      const hits = META_COMMANDS.filter((cmd) => cmd.startsWith(lower));
      return [hits.length ? [...hits] : [...META_COMMANDS], line] as [string[], string];
    },
    historySize: 200,
  });

  agent.subscribe((event) => {
    renderer(event);
    if (event.type === "agent_end" && awaitingAgent && !exiting) {
      awaitingAgent = false;
      rl.resume();
      rl.prompt();
    }
  });

  rl.setPrompt(c.primary("you ❯ "));

  rl.on("close", () => {
    exiting = true;
    stopSpinner();
    if (agent.state.isStreaming) agent.abort();
    console.log();
    console.log(c.dim(`research is a journey · session $${totalCostUsd().toFixed(4)}`));
    process.exit(0);
  });

  rl.on("SIGINT", () => {
    stopSpinner();
    if (agent.state.isStreaming) {
      agent.abort();
      return;
    }
    rl.close();
  });

  showHelpHint();
  rl.prompt();

  rl.on("line", (raw) => {
    const line = raw.trim();
    if (!line) {
      rl.prompt();
      return;
    }

    if (handleMetaCommand(line, rl, agent)) return;

    awaitingAgent = true;
    rl.pause();
    renderer.reset();
    void agent.prompt(line).catch((err: unknown) => {
      if (exiting) return;
      const e = err as Error;
      console.log();
      console.log(c.bad(`error: ${e.message}`));
      if (awaitingAgent) {
        awaitingAgent = false;
        rl.resume();
        rl.prompt();
      }
    });
  });
}

function handleMetaCommand(line: string, rl: readline.Interface, agent: ReturnType<typeof buildProfAgent>): boolean {
  const cmd = line.toLowerCase();
  if (cmd === "exit" || cmd === "quit") {
    rl.close();
    return true;
  }
  if (cmd === "clear") {
    console.clear();
    rl.prompt();
    return true;
  }
  if (cmd === "reset") {
    // Reset only the pi-agent conversation; prof's persisted library stays intact.
    agent.reset();
    console.log(c.dim("session reset"));
    rl.prompt();
    return true;
  }
  if (cmd === "help" || cmd === "?" || cmd === "h") {
    showHelp();
    rl.prompt();
    return true;
  }
  return false;
}

function showHelpHint(): void {
  console.log(c.dim("Ask naturally. Examples:"));
  console.log(c.dim("  map mechanistic interpretability"));
  console.log(c.dim("  what should I read next for sparse autoencoders?"));
  console.log(c.dim("  find citations for scaling laws improve transfer"));
  console.log();
  console.log(
    c.dim("Meta commands: ") +
      c.bold("help") +
      c.dim(" / ") +
      c.bold("clear") +
      c.dim(" / ") +
      c.bold("reset") +
      c.dim(" / ") +
      c.bold("exit"),
  );
  console.log();
}

function showHelp(): void {
  console.log();
  console.log(c.bold("prof shell"));
  console.log(c.dim("Natural-language research assistant. The model chooses tools like read_paper, map_field, ask_library, find_citations, find_gap, next_paper, daily_picks, brainstorm_idea, library_status, and list_library."));
  console.log();
  console.log(c.bold("Try:"));
  console.log(`  ${c.accent("read 1706.03762")}`);
  console.log(`  ${c.accent("map retrieval augmented generation for scientific literature")}`);
  console.log(`  ${c.accent("what have I read about mechanistic interpretability?")}`);
  console.log(`  ${c.accent("find a research gap between diffusion models and sparse autoencoders")}`);
  console.log();
  console.log(c.bold("Meta:"));
  console.log(`  ${c.accent("help".padEnd(8))} ${c.dim("show this help")}`);
  console.log(`  ${c.accent("clear".padEnd(8))} ${c.dim("clear the screen")}`);
  console.log(`  ${c.accent("reset".padEnd(8))} ${c.dim("clear this agent conversation")}`);
  console.log(`  ${c.accent("exit".padEnd(8))} ${c.dim("leave the shell (Ctrl+D)")}`);
  console.log();
}

function createEventRenderer(): ((event: AgentEvent) => void) & { reset: () => void } {
  let printedAssistantText = false;
  let printedThinking = false;

  const render = ((event: AgentEvent) => {
    switch (event.type) {
      case "agent_start":
      case "turn_start":
      case "message_start":
        break;

      case "message_update":
        renderMessageUpdate(event.assistantMessageEvent);
        break;

      case "tool_execution_start": {
        endInlineBlock();
        // Don't log here — toolcall_end already announced this tool.
        startSpinner(event.toolName);
        break;
      }

      case "tool_execution_update":
        // Tool emitted progress — keep spinner ticking.
        break;

      case "tool_execution_end": {
        stopSpinner();
        renderToolResultSummary(event.toolName, event.result, event.isError);
        break;
      }

      case "message_end":
        if (event.message.role === "assistant" && event.message.errorMessage) {
          endInlineBlock();
          console.log(c.bad(event.message.errorMessage));
        }
        break;

      case "turn_end":
        break;

      case "agent_end":
        stopSpinner();
        endInlineBlock();
        break;
    }
  }) as ((event: AgentEvent) => void) & { reset: () => void };

  render.reset = () => {
    printedAssistantText = false;
    printedThinking = false;
  };

  function renderMessageUpdate(event: AssistantMessageEvent): void {
    switch (event.type) {
      case "thinking_delta":
        if (!printedThinking) {
          process.stdout.write(c.dim("thinking: "));
          printedThinking = true;
        }
        process.stdout.write(c.dim(event.delta));
        break;

      case "thinking_end":
        if (printedThinking) process.stdout.write("\n");
        printedThinking = false;
        break;

      case "text_delta":
        if (!printedAssistantText) {
          process.stdout.write(c.bold("prof: "));
          printedAssistantText = true;
        }
        process.stdout.write(event.delta);
        break;

      case "toolcall_end":
        endInlineBlock();
        // Pretty: just show "▸ tool_name" with a short hint, not the full JSON
        process.stdout.write(c.dim("  ▸ ") + c.accent(event.toolCall.name));
        process.stdout.write(c.dim(briefArgs(event.toolCall.arguments)));
        process.stdout.write("\n");
        break;

      case "error":
        endInlineBlock();
        console.log(c.bad(event.error.errorMessage ?? "model error"));
        break;

      default:
        break;
    }
  }

  function renderToolResultSummary(
    toolName: string,
    result: Partial<AgentToolResult<unknown>> | undefined,
    isError = false,
  ): void {
    const text = resultText(result);
    endInlineBlock();
    if (isError) {
      console.log(c.bad("  ✗ ") + toolName + c.bad(" failed: ") + truncate(text || "(no error message)", 200));
      return;
    }
    // Tool-specific compact summary
    const summary = summarizeToolResult(toolName, text);
    console.log(c.ok("  ✓ ") + summary);
  }

  function endInlineBlock(): void {
    if (printedAssistantText || printedThinking) process.stdout.write("\n");
    printedAssistantText = false;
    printedThinking = false;
  }

  return render;
}

/**
 * Compact, useful summary line per tool. Falls back to char count.
 * Reads salient lines from the tee'd tool output.
 */
function summarizeToolResult(toolName: string, text: string): string {
  if (!text) return `${toolName} (done)`;
  switch (toolName) {
    case "read_paper": {
      const titleLine = /Read: (.+)/m.exec(text)?.[1];
      const cost = /Cost: \$(\S+)/m.exec(text)?.[1];
      if (titleLine) {
        const t = titleLine.length > 60 ? titleLine.slice(0, 57) + "…" : titleLine;
        return `read ${t}${cost ? `  ($${cost})` : ""}`;
      }
      break;
    }
    case "map_field": {
      const papers = /(\d+) papers/.exec(text)?.[1];
      const subfields = /(\d+) subfields/.exec(text)?.[1];
      const dir = /→ (.+)/.exec(text)?.[1];
      if (papers && subfields) return `mapped ${papers} papers · ${subfields} subfields${dir ? `  → ${truncate(dir.trim(), 40)}` : ""}`;
      break;
    }
    case "ask_library":
      return "answered from library";
    case "find_citations":
    case "cite": {
      const n = (text.match(/^@article\{/gm) ?? []).length;
      if (n > 0) return `found ${n} citation${n === 1 ? "" : "s"} (+ BibTeX)`;
      break;
    }
    case "find_gap":
    case "gap": {
      const m = /Intersection size: \*\*(\d+)/.exec(text);
      if (m) return `intersection: ${m[1]} papers found`;
      break;
    }
    case "next_paper":
    case "next": {
      const t = /next ▸ (.+)/.exec(text)?.[1];
      if (t) return `next: ${truncate(t.trim(), 60)}`;
      break;
    }
    case "daily_picks":
    case "daily": {
      const n = (text.match(/^\d+\.\s/gm) ?? []).length;
      if (n > 0) return `${n} arxiv pick${n === 1 ? "" : "s"} for today`;
      break;
    }
    case "library_status":
    case "history": {
      const m = /library: (\d+) papers/.exec(text);
      if (m) return `library: ${m[1]} papers`;
      break;
    }
    case "brainstorm_idea":
    case "brainstorm":
      return "3 framings + 5 angles generated";
    case "list_library": {
      const n = (text.match(/^\d+\.\s/gm) ?? []).length;
      return n > 0 ? `${n} papers listed` : "library listed";
    }
    case "read":
    case "write":
    case "edit": {
      const m = /Successfully\s+(read|wrote|edited|updated)?\s*(\d+)?\s*(bytes|lines)?/i.exec(text);
      if (m) return `${toolName}: ${m[0].toLowerCase()}`;
      break;
    }
    case "bash": {
      const first = text.split("\n").find((l) => l.trim().length > 0);
      if (first) return `bash: ${truncate(first.trim(), 70)}`;
      break;
    }
  }
  const chars = text.length;
  return `${toolName} (${chars} chars)`;
}

function resultText(result: Partial<AgentToolResult<unknown>> | undefined): string {
  const content = result?.content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item: TextContent | ImageContent) => {
      if (item.type === "text") return item.text;
      return `[image ${item.mimeType}]`;
    })
    .join("\n")
    .trim();
}

function formatArgs(args: unknown): string {
  if (!args || (typeof args === "object" && Object.keys(args).length === 0)) return "";
  try {
    return ` ${JSON.stringify(args)}`;
  } catch {
    return "";
  }
}

// ============================================================
// Tool spinner — shows elapsed time so user knows we're alive
// ============================================================

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
let spinnerInterval: NodeJS.Timeout | null = null;
let spinnerStart = 0;
let spinnerName = "";

function startSpinner(name: string): void {
  if (!process.stdout.isTTY) return;
  stopSpinner();
  spinnerName = name;
  spinnerStart = Date.now();
  let frame = 0;
  spinnerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - spinnerStart) / 1000);
    process.stdout.write(
      `\r  ${c.accent(SPINNER_FRAMES[frame % SPINNER_FRAMES.length]!)} ${spinnerName} ${c.dim(`(${elapsed}s)`)}    `,
    );
    frame++;
  }, 100);
}

function stopSpinner(): void {
  if (spinnerInterval) {
    clearInterval(spinnerInterval);
    spinnerInterval = null;
    // Clear the spinner line
    process.stdout.write("\r" + " ".repeat(60) + "\r");
  }
}

/** A compact, human-friendly hint of what the tool is being called with. */
function briefArgs(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const obj = args as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of Object.keys(obj).slice(0, 2)) {
    const v = obj[k];
    if (typeof v === "string" && v.length > 0) {
      const short = v.length > 40 ? v.slice(0, 37) + "…" : v;
      parts.push(`${k}="${short}"`);
    } else if (typeof v === "number" || typeof v === "boolean") {
      parts.push(`${k}=${v}`);
    }
  }
  return parts.length ? `  ${parts.join(" ")}` : "";
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}
