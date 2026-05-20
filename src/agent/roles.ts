/**
 * Researcher roles. Not all researchers are professors — onboarding picks
 * one and the agent + welcome screen calibrate to it.
 */

export type Role =
  | "phd_student"
  | "postdoc"
  | "faculty"
  | "industry"
  | "independent";

export interface RoleSpec {
  id: Role;
  label: string;          // shown in onboarding picker
  hint: string;           // one-line tagline
  emphasis: string[];     // commands to surface in welcome NEXT MOVES
  promptFragment: string; // appended to system prompt
}

export const ROLES: RoleSpec[] = [
  {
    id: "phd_student",
    label: "PhD student",
    hint: "finding direction, building a library, writing your first papers",
    emphasis: ["next", "brainstorm", "gap", "read", "ask", "outline", "cite", "daily"],
    promptFragment: `The user is a PhD student. They are early-to-mid in their research journey. Optimize for:
- Finding direction (gap, brainstorm, next) — they often don't know what to work on yet.
- Building reading depth (read, daily, ask) — encourage habit-forming.
- Their first paper (outline, cite, relwork) — be supportive, not critical.
- Tone: warm peer, not authoritative professor. Encourage when they struggle.`,
  },
  {
    id: "postdoc",
    label: "Postdoc / Research scientist",
    hint: "staying current, broadening collaboration, publishing fast",
    emphasis: ["daily", "ask", "cite", "relwork", "collab", "next", "compare"],
    promptFragment: `The user is a postdoc or research scientist. Optimize for:
- Staying across the field (daily, ask, compare) — they read widely.
- Writing fast (cite, relwork, outline) — they ship papers.
- Collaboration and network (collab) — they're job-hunting or building independence.
- Tone: peer-level. They know the field. Cut the hand-holding.`,
  },
  {
    id: "faculty",
    label: "Faculty / PI",
    hint: "lab strategy, grants, advising, big-picture syntheses",
    emphasis: ["collab", "history", "graph", "relwork", "ask", "outline", "map"],
    promptFragment: `The user is faculty / a PI. They have less time than other roles. Optimize for:
- Strategic syntheses (map, relwork, graph) — they need overviews fast.
- Tracking what their lab/network is doing (collab, history).
- Grants and reviews — assume they're writing high-stakes documents.
- Tone: direct, no fluff, no encouragement padding. Cite precisely.`,
  },
  {
    id: "industry",
    label: "Industry / applied researcher",
    hint: "synthesis for products, less direction-finding",
    emphasis: ["read", "ask", "cite", "relwork", "compare", "map"],
    promptFragment: `The user is an industry / applied researcher. Optimize for:
- Synthesis (relwork, compare, ask) — they translate research to products.
- Concrete citations (cite, read) — they often justify decisions internally.
- They care less about thesis-finding (gap, brainstorm); skip those unless asked.
- Tone: pragmatic, output-oriented. Bias toward "what's the implication".`,
  },
  {
    id: "independent",
    label: "Independent / curious learner",
    hint: "exploring a field for the love of it",
    emphasis: ["map", "read", "ask", "daily", "brainstorm"],
    promptFragment: `The user is an independent learner / amateur researcher. They love this field. Optimize for:
- Field orientation (map) — they may not know the canon yet.
- Friendly explanations (ask) — defuse jargon when possible.
- They probably don't write papers — skip cite/outline/relwork unless asked.
- Tone: enthusiastic, jargon-aware (define terms once, then use them).`,
  },
];

export function findRole(id: string): RoleSpec | undefined {
  return ROLES.find((r) => r.id === id);
}

export const DEFAULT_ROLE: Role = "phd_student";
