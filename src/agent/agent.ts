import * as fs from "node:fs";
import { Agent } from "@earendil-works/pi-agent-core";
import { getModel } from "@earendil-works/pi-ai";
import { buildProfTools } from "./tools.js";
import { createSandboxedTools } from "./sandbox.js";
import { countPapers } from "../db/client.js";
import { paths } from "../config/paths.js";
import { findRole, DEFAULT_ROLE, type Role } from "./roles.js";
import { MODELS } from "../lib/llm.js";

const SYSTEM_PROMPT_BASE = `You are peer — a terminal-native research agent. Slogan: research is a journey.

You serve the user as their peer, not their professor. Egalitarian tone:
they're a researcher, you're a researcher (with infinite memory + tool access).

You serve ONE researcher. Their role is configured in their profile; calibrate accordingly (see ROLE block below).

You have two kinds of tools:

A) RESEARCH TOOLS (peer's domain — prefer these):
   read_paper, map_field, ask_library, find_citations, find_gap,
   next_paper, daily_picks, brainstorm_idea, library_status, list_library

B) SANDBOXED FILE TOOLS (restricted to the user's peer home directory):
   read, write, edit, grep, find, ls
   Use these to save/read notes, fields, summaries, exports.
   All file paths are jailed to the peer home — you CANNOT read or write outside it.
   You do NOT have a bash/shell tool.

The peer home directory is your ONLY working area. Library: peer.db.
Notes go under notes/. Save user-requested files there by default
unless they specify a relative path within the home.

Behaviors:
- Be terse. Researchers are busy.
- Greet warmly in 1-2 sentences, then one focused question.
- For brand-new users (empty library), guide an onboarding conversation.
- Substantive question + library has papers → call ask_library.
- "What should I read next?" → call next_paper.
- "Save this as a file" → use write tool with a path inside the home.
- Honor reading trails — use next_paper to continue them.
- Cite papers with (arxiv:ID) when you mention them.
- Style: plain English, no emoji, no headings unless asked, prefer 3-7 line answers.`;

interface ProfileSnapshot {
  name: string | null;
  role: Role;
  primarySubfield: string | null;
}

function readProfile(): ProfileSnapshot {
  try {
    const p = paths.profile();
    if (!fs.existsSync(p)) return { name: null, role: DEFAULT_ROLE, primarySubfield: null };
    const md = fs.readFileSync(p, "utf-8");
    const fm = md.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
    if (!fm) return { name: null, role: DEFAULT_ROLE, primarySubfield: null };
    const yaml = fm[1] ?? "";
    const name = yaml.match(/^name:\s*"?([^"\n]+)"?/m)?.[1]?.trim() ?? null;
    const roleRaw = yaml.match(/^role:\s*([a-z_]+)/im)?.[1]?.trim();
    const subfield = yaml.match(/^primary_subfield:\s*"?([^"\n]+)"?/m)?.[1]?.trim() ?? null;
    const validRole: Role = findRole(roleRaw ?? "")?.id ?? DEFAULT_ROLE;
    return { name, role: validRole, primarySubfield: subfield === "null" ? null : subfield };
  } catch {
    return { name: null, role: DEFAULT_ROLE, primarySubfield: null };
  }
}

function buildSystemPrompt(): string {
  const profile = readProfile();
  const role = findRole(profile.role) ?? findRole(DEFAULT_ROLE)!;
  const lib = countPapers();
  const home = paths.home();

  return [
    SYSTEM_PROMPT_BASE,
    "",
    "═══ ROLE ═══",
    role.promptFragment,
    "",
    "═══ CONTEXT SNAPSHOT ═══",
    `- user: ${profile.name ?? "(unknown)"}`,
    `- role: ${profile.role}`,
    `- primary subfield: ${profile.primarySubfield ?? "(not yet set)"}`,
    `- library: ${lib} paper${lib === 1 ? "" : "s"}`,
    `- peer home (sandbox root): ${home}`,
    `- save files without an explicit path to: ${home}/notes/<slug>.md`,
  ].join("\n");
}

export function createPeerAgent(opts: { verbose?: boolean } = {}): Agent {
  const peerResearchTools = buildProfTools(!!opts.verbose);
  const fileTools = createSandboxedTools(paths.home());
  const tools = [...peerResearchTools, ...fileTools];

  return new Agent({
    initialState: {
      systemPrompt: buildSystemPrompt(),
      model: getModel("anthropic", MODELS.smart),
      thinkingLevel: "low",
      tools,
    },
    toolExecution: "parallel",
  });
}

// Legacy aliases — internal callers may still use these
export const createProfAgent = createPeerAgent;
export const buildProfAgent = createPeerAgent;
