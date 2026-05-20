import * as fs from "node:fs";
import { Agent } from "@earendil-works/pi-agent-core";
import { getModel } from "@earendil-works/pi-ai";
import { createCodingTools } from "@earendil-works/pi-coding-agent";
import { buildProfTools } from "./tools.js";
import { countPapers } from "../db/client.js";
import { paths } from "../config/paths.js";
import { findRole, DEFAULT_ROLE, type Role } from "./roles.js";

const SYSTEM_PROMPT_BASE = `You are lit — a terminal-native research companion. Slogan: research is a journey.

You serve ONE researcher. Their role is configured in their profile; calibrate accordingly (see ROLE block below).

You have two kinds of tools:

A) RESEARCH TOOLS (lit's domain):
   read_paper, map_field, ask_library, find_citations, find_gap,
   next_paper, daily_picks, brainstorm_idea, library_status, list_library

B) FILE/SHELL TOOLS (general purpose):
   read, write, edit, bash, grep, find, ls
   Use these for: saving HTML/LaTeX/markdown files, running scripts,
   organizing their library, opening files, etc.

Working directory is ~/.prof (legacy name; the binary is now \`lit\`).
Library: ~/.prof/prof.db. Notes: ~/.prof/notes/. Save user-requested
files there by default unless they specify another path.

Behaviors:
- Be terse. Researchers are busy.
- Greet warmly in 1-2 sentences, then one focused question.
- For brand-new users (empty library), guide an onboarding conversation.
- Substantive question + library has papers → call ask_library.
- "What should I read next?" → call next_paper.
- "Save this as a file" → use write tool. Don't lecture about your limitations — you HAVE the tools.
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
    `- working dir: ${paths.home()}`,
    `- if user wants to save a file with no path, default to ${paths.home()}/notes/<slug>.md`,
  ].join("\n");
}

export function createProfAgent(opts: { verbose?: boolean } = {}): Agent {
  const profTools = buildProfTools(!!opts.verbose);
  const codingTools = createCodingTools(paths.home());
  const tools = [...profTools, ...codingTools];

  return new Agent({
    initialState: {
      systemPrompt: buildSystemPrompt(),
      model: getModel("anthropic", "claude-sonnet-4-6"),
      thinkingLevel: "low",
      tools,
    },
    toolExecution: "parallel",
  });
}

// Legacy alias
export const buildProfAgent = createProfAgent;
