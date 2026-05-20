import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

let _claude: Anthropic | null = null;
let _openai: OpenAI | null = null;

export function claude(): Anthropic {
  if (_claude) return _claude;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY not set. peer requires Claude for reasoning.");
  }
  _claude = new Anthropic({ apiKey });
  return _claude;
}

export function openai(): OpenAI {
  if (_openai) return _openai;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not set. peer uses OpenAI for embeddings.");
  }
  _openai = new OpenAI({ apiKey });
  return _openai;
}

export const MODELS = {
  smart: "claude-sonnet-4-6",
  cheap: "claude-haiku-4-5",
  embed: "text-embedding-3-small",
} as const;

// --- Cost tracking ---

export interface CostEntry {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  costUsd: number;
}

const costs: CostEntry[] = [];

export function recordCost(entry: CostEntry): void {
  costs.push(entry);
}

export function totalCostUsd(): number {
  return costs.reduce((sum, c) => sum + c.costUsd, 0);
}

export function costSummary(): { total: number; byModel: Record<string, number> } {
  const byModel: Record<string, number> = {};
  for (const c of costs) {
    byModel[c.model] = (byModel[c.model] ?? 0) + c.costUsd;
  }
  return { total: totalCostUsd(), byModel };
}

// --- Pricing (USD per 1M tokens, May 2026) ---

const PRICING: Record<string, { input: number; output: number; cacheRead?: number; cacheWrite?: number }> = {
  "claude-sonnet-4-6":        { input: 3,    output: 15,  cacheRead: 0.30, cacheWrite: 3.75 },
  "claude-haiku-4-5":         { input: 1,    output: 5,   cacheRead: 0.10, cacheWrite: 1.25 },
  "text-embedding-3-small":   { input: 0.02, output: 0 },
};

export function priceTokens(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheWriteTokens = 0,
): number {
  const p = PRICING[model];
  if (!p) return 0;
  return (
    (inputTokens * p.input +
      outputTokens * p.output +
      cacheReadTokens * (p.cacheRead ?? 0) +
      cacheWriteTokens * (p.cacheWrite ?? 0)) /
    1_000_000
  );
}

/**
 * One-shot Claude completion with cost tracking.
 */
export async function complete(opts: {
  model?: string;
  system?: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<{ text: string; cost: CostEntry }> {
  const model = opts.model ?? MODELS.smart;
  const msg = await claude().messages.create({
    model,
    max_tokens: opts.maxTokens ?? 4096,
    temperature: opts.temperature ?? 0.3,
    system: opts.system,
    messages: [{ role: "user", content: opts.prompt }],
  });

  const inputTokens = msg.usage.input_tokens ?? 0;
  const outputTokens = msg.usage.output_tokens ?? 0;
  const cacheReadTokens = (msg.usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0;
  const cacheWriteTokens = (msg.usage as { cache_creation_input_tokens?: number }).cache_creation_input_tokens ?? 0;

  const costUsd = priceTokens(model, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens);
  const cost: CostEntry = { model, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, costUsd };
  recordCost(cost);

  const text = msg.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("\n");

  return { text, cost };
}

/** Batch embeddings via OpenAI. */
export async function embed(texts: string[]): Promise<{ vectors: number[][]; cost: CostEntry }> {
  if (texts.length === 0) return { vectors: [], cost: zeroCost(MODELS.embed) };
  const resp = await openai().embeddings.create({
    model: MODELS.embed,
    input: texts,
  });
  const vectors = resp.data.map((d) => d.embedding);
  const inputTokens = resp.usage.total_tokens ?? 0;
  const costUsd = priceTokens(MODELS.embed, inputTokens, 0);
  const cost: CostEntry = { model: MODELS.embed, inputTokens, outputTokens: 0, costUsd };
  recordCost(cost);
  return { vectors, cost };
}

function zeroCost(model: string): CostEntry {
  return { model, inputTokens: 0, outputTokens: 0, costUsd: 0 };
}
