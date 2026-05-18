/**
 * Agent tools: each prof command exposed as an AgentTool so the LLM can
 * call them autonomously based on natural language.
 *
 * Tools that print to stdout (most of them) capture output into a string
 * and return it as the tool result, so the agent can see what happened.
 */
import { Type, type TSchema } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { db, countPapers, type PaperRow } from "../db/client.js";

// Shortcuts to make tool definitions terse + properly typed.
type ProfTool = AgentTool<TSchema, null>;
type ToolResult = AgentToolResult<null>;

/** Capture console.log output during a callback. */
async function captureStdout(fn: () => Promise<unknown> | unknown): Promise<string> {
  const chunks: string[] = [];
  const orig = console.log;
  console.log = (...args: unknown[]) => {
    chunks.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  };
  try {
    await fn();
  } finally {
    console.log = orig;
  }
  // Strip ANSI for the LLM
  return chunks.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
}

function asText(text: string): ToolResult {
  return { content: [{ type: "text", text: text.slice(0, 20_000) }], details: null };
}

function defineTool<S extends TSchema>(tool: AgentTool<S, null>): ProfTool {
  return tool as unknown as ProfTool;
}

export function buildProfTools(verbose: boolean = false): ProfTool[] {
  return [
    defineTool({
      name: "read_paper",
      label: "Read paper",
      description:
        "Deep-read one paper by arxiv id, DOI, or URL. Fetches metadata, extracts contribution/method/datasets/metrics, persists to the knowledge graph, and writes an Obsidian-compatible note.",
      parameters: Type.Object({
        id: Type.String({ description: "arxiv id like '1706.03762', DOI like '10.x/y', or full URL" }),
      }),
      execute: async (_id, params) => {
        const { profRead } = await import("../commands/read.js");
        const out = await captureStdout(async () => {
          const r = await profRead(params.id, { verbose });
          console.log(`Read: ${r.title}`);
          console.log(`Note: ${r.notePath}`);
          console.log(`Cost: $${r.cost.toFixed(4)}`);
        });
        return asText(out);
      },
    }),
    defineTool({
      name: "map_field",
      label: "Map field",
      description:
        "Map a research field: searches Semantic Scholar/OpenAlex for ~50-100 papers, clusters into subareas, generates a narrative overview, reading order, and open problems. Use for orientation in an unfamiliar area. Takes ~60-120s and costs ~$0.05.",
      parameters: Type.Object({
        topic: Type.String({ description: "The research topic, e.g. 'mechanistic interpretability'" }),
        limit: Type.Optional(Type.Number({ description: "Max papers to seed from (default 50)" })),
      }),
      execute: async (_id, params) => {
        const { cmdMap } = await import("../commands/map.js");
        const out = await captureStdout(() => cmdMap(params.topic, { limit: params.limit, verbose }));
        return asText(out);
      },
    }),
    defineTool({
      name: "ask_library",
      label: "Ask library",
      description:
        "Answer a question by retrieving from the user's local library (RAG). Returns a cited answer with source papers. Use when the user asks a substantive question about something they may have read.",
      parameters: Type.Object({
        question: Type.String({ description: "The research question" }),
      }),
      execute: async (_id, params) => {
        if (countPapers() === 0) {
          return asText(
            "The user's library is empty. Suggest they run `prof read <arxiv-id>` to seed their library first, or use `map_field` to learn about a topic from scratch.",
          );
        }
        const { cmdAsk } = await import("../commands/ask.js");
        const out = await captureStdout(() => cmdAsk(params.question, { verbose }));
        return asText(out);
      },
    }),
    defineTool({
      name: "find_citations",
      label: "Find citations",
      description:
        "Find papers (with BibTeX) that support a writing claim. Use when the user is drafting a paper and needs citations for a specific assertion.",
      parameters: Type.Object({
        claim: Type.String({ description: "The claim that needs citations" }),
      }),
      execute: async (_id, params) => {
        const { cmdCite } = await import("../commands/cite.js");
        const out = await captureStdout(() => cmdCite(params.claim, { verbose }));
        return asText(out);
      },
    }),
    defineTool({
      name: "find_gap",
      label: "Find gap",
      description:
        "Find research gaps at the intersection of 2+ concepts. Use when the user is looking for thesis topics or unexplored research directions.",
      parameters: Type.Object({
        topics: Type.String({ description: "Two or more concepts, e.g. 'sparse autoencoders and diffusion models'" }),
      }),
      execute: async (_id, params) => {
        const { cmdGap } = await import("../commands/gap.js");
        const out = await captureStdout(() => cmdGap(params.topics, { verbose }));
        return asText(out);
      },
    }),
    defineTool({
      name: "next_paper",
      label: "Next paper to read",
      description:
        "Given a research goal, recommend ONE next paper from the library or external sources, and persist it as part of a reading trail. Use when the user asks 'what should I read?' or 'continue my reading'.",
      parameters: Type.Object({
        goal: Type.Optional(
          Type.String({ description: "The research goal. If omitted, continues the most recent active trail." }),
        ),
      }),
      execute: async (_id, params) => {
        const { cmdNext } = await import("../commands/next.js");
        const out = await captureStdout(() => cmdNext(params.goal ?? null, { verbose }));
        return asText(out);
      },
    }),
    defineTool({
      name: "daily_picks",
      label: "Daily picks",
      description:
        "Today's top 3 arxiv papers, ranked by similarity to the user's library. Use when the user asks what's new today or what to read this morning.",
      parameters: Type.Object({}),
      execute: async () => {
        const { cmdDaily } = await import("../commands/daily.js");
        const out = await captureStdout(() => cmdDaily({ verbose }));
        return asText(out);
      },
    }),
    defineTool({
      name: "brainstorm_idea",
      label: "Brainstorm",
      description:
        "Expand a vague half-formed research idea into 3 concrete framings + 5 adjacent angles + suggested first reads. Use when the user is fumbling with an idea.",
      parameters: Type.Object({
        seed: Type.String({ description: "The vague idea or seed thought" }),
      }),
      execute: async (_id, params) => {
        const { cmdBrainstorm } = await import("../commands/brainstorm.js");
        const out = await captureStdout(() => cmdBrainstorm(params.seed, { verbose }));
        return asText(out);
      },
    }),
    defineTool({
      name: "library_status",
      label: "Library status",
      description:
        "Show what's in the user's library and notes. Use when the user asks 'what have I done' or 'show me my history'.",
      parameters: Type.Object({}),
      execute: async () => {
        const { cmdHistory } = await import("../commands/history.js");
        const out = await captureStdout(() => cmdHistory({ verbose }));
        return asText(out);
      },
    }),
    defineTool({
      name: "list_library",
      label: "List library",
      description: "Plain list of papers in the user's library. Used by the LLM as a sanity check, not user-facing.",
      parameters: Type.Object({}),
      execute: async () => {
        const rows = db()
          .prepare<[], Pick<PaperRow, "title" | "year" | "arxiv_id">>(
            "SELECT title, year, arxiv_id FROM papers ORDER BY ingested_at DESC LIMIT 25",
          )
          .all();
        if (rows.length === 0) return asText("Library is empty.");
        return asText(
          rows.map((r, i) => `${i + 1}. ${r.title} (${r.year ?? "?"})${r.arxiv_id ? ` arxiv:${r.arxiv_id}` : ""}`).join("\n"),
        );
      },
    }),
  ];
}
