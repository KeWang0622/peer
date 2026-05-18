/**
 * Natural-language REPL for `prof shell`.
 *
 * This shell is a real pi-agent-core Agent: user text goes straight to the
 * model, which decides when to call prof's research tools.
 */
import * as readline from "node:readline";
import type { AgentEvent, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { AssistantMessageEvent, ImageContent, TextContent } from "@earendil-works/pi-ai";
import { createProfAgent } from "../agent/agent.js";
import { totalCostUsd } from "../lib/llm.js";
import { c } from "./colors.js";
import { printWelcome } from "./welcome.js";

const META_COMMANDS = ["help", "clear", "exit", "quit"] as const;

export async function cmdShell(opts: { verbose?: boolean } = {}): Promise<void> {
  const agent = createProfAgent({ verbose: !!opts.verbose });
  const renderer = createEventRenderer();

  printWelcome();
  showHelpHint();

  agent.subscribe((event) => {
    renderer(event);
  });

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

  rl.setPrompt(c.primary("prof ❯ "));

  rl.on("close", () => {
    if (agent.state.isStreaming) agent.abort();
    console.log();
    console.log(c.dim("Research is a journey. session $") + c.dim(totalCostUsd().toFixed(4)));
    process.exit(0);
  });

  rl.on("SIGINT", () => {
    if (agent.state.isStreaming) {
      agent.abort();
      return;
    }
    rl.close();
  });

  rl.prompt();

  rl.on("line", async (raw) => {
    const line = raw.trim();
    if (!line) {
      rl.prompt();
      return;
    }

    if (handleMetaCommand(line, rl)) return;

    rl.pause();
    try {
      renderer.reset();
      await agent.prompt(line);
    } catch (err) {
      const e = err as Error;
      console.log();
      console.log(c.bad(`error: ${e.message}`));
    } finally {
      rl.resume();
      rl.prompt();
    }
  });
}

function handleMetaCommand(line: string, rl: readline.Interface): boolean {
  const cmd = line.toLowerCase();
  if (cmd === "exit" || cmd === "quit") {
    rl.close();
    return true;
  }
  if (cmd === "clear") {
    console.clear();
    printWelcome();
    showHelpHint();
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
  console.log(c.dim("Meta commands: ") + c.bold("help") + c.dim(" / ") + c.bold("clear") + c.dim(" / ") + c.bold("exit"));
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

      case "tool_execution_start":
        endInlineBlock();
        console.log(c.dim("tool ") + c.accent(event.toolName) + c.dim(formatArgs(event.args)));
        break;

      case "tool_execution_update":
        renderToolResult(event.partialResult);
        break;

      case "tool_execution_end":
        renderToolResult(event.result, event.isError);
        break;

      case "message_end":
        if (event.message.role === "assistant" && event.message.errorMessage) {
          endInlineBlock();
          console.log(c.bad(event.message.errorMessage));
        }
        break;

      case "turn_end":
        break;

      case "agent_end":
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
        console.log(c.dim("requested ") + c.accent(event.toolCall.name) + c.dim(formatArgs(event.toolCall.arguments)));
        break;

      case "error":
        endInlineBlock();
        console.log(c.bad(event.error.errorMessage ?? "model error"));
        break;

      default:
        break;
    }
  }

  function renderToolResult(result: Partial<AgentToolResult<unknown>> | undefined, isError = false): void {
    const text = resultText(result);
    if (!text) return;
    endInlineBlock();
    const label = isError ? c.bad("tool error") : c.dim("result");
    console.log(label + c.dim(": ") + truncate(text, 4_000));
  }

  function endInlineBlock(): void {
    if (printedAssistantText || printedThinking) process.stdout.write("\n");
    printedAssistantText = false;
    printedThinking = false;
  }

  return render;
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

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}
