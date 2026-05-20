import Anthropic from "@anthropic-ai/sdk";
import Database from "better-sqlite3";
import OpenAI from "openai";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { paths } from "../config/paths.js";
import { MODELS } from "../lib/llm.js";

type CheckStatus = "pass" | "warn" | "fail";

interface CheckResult {
  label: string;
  message: string;
  required: boolean;
  status: CheckStatus;
}

const CHECK_ICON: Record<CheckStatus, string> = {
  pass: "✓",
  warn: "⚠",
  fail: "✗",
};

export async function cmdDoctor(): Promise<{ passed: number; total: number; failedRequired: number }> {
  console.log("\npeer doctor\n");

  const checks = await Promise.all([
    checkNodeVersion(),
    checkAnthropicApiKey(),
    checkOpenAiApiKey(),
    checkSqlite(),
    checkNetwork("Semantic Scholar", "https://api.semanticscholar.org/graph/v1/paper/search?query=test&limit=1&fields=paperId"),
    checkNetwork("arXiv export", "https://export.arxiv.org/api/query?search_query=all:test&start=0&max_results=1"),
    checkProfHomeWritable(),
    checkSemanticScholarApiKey(),
  ]);

  const width = Math.max(...checks.map((check) => check.label.length));
  for (const check of checks) {
    console.log(`${CHECK_ICON[check.status]} ${check.label.padEnd(width)}  ${check.message}`);
  }

  const passed = checks.filter((check) => check.status === "pass").length;
  const failedRequired = checks.filter((check) => check.required && check.status === "fail").length;
  console.log(`\n${passed} of ${checks.length} checks passed\n`);

  return { passed, total: checks.length, failedRequired };
}

function checkNodeVersion(): CheckResult {
  const version = process.versions.node;
  const parsed = parseVersion(version);
  if (!parsed) {
    return fail("Node.js >=22.0.0", `could not parse ${version}`);
  }

  if (compareVersions(parsed, [22, 0, 0]) >= 0) {
    return pass("Node.js >=22.0.0", version);
  }

  if (compareVersions(parsed, [20, 0, 0]) >= 0) {
    return warn("Node.js >=22.0.0", `${version}; recommended >=22.0.0`);
  }

  return fail("Node.js >=22.0.0", `${version}; too old for peer`);
}

async function checkAnthropicApiKey(): Promise<CheckResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return fail("ANTHROPIC_API_KEY", "not set");
  }

  try {
    const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 10_000 });
    await withTimeout(
      client.messages.create({
        model: MODELS.cheap,
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      }),
      12_000,
      "Anthropic test call",
    );
    return pass("ANTHROPIC_API_KEY", "present and verified");
  } catch (err) {
    return fail("ANTHROPIC_API_KEY", `test call failed: ${errorMessage(err)}`);
  }
}

async function checkOpenAiApiKey(): Promise<CheckResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return warn("OPENAI_API_KEY", "not set; map embeddings will be unavailable", false);
  }

  try {
    const client = new OpenAI({ apiKey, maxRetries: 0, timeout: 10_000 });
    await withTimeout(
      client.embeddings.create({
        model: MODELS.embed,
        input: "ping",
      }),
      12_000,
      "OpenAI embeddings test call",
    );
    return pass("OPENAI_API_KEY", "present and verified", false);
  } catch (err) {
    return fail("OPENAI_API_KEY", `embeddings test failed: ${errorMessage(err)}`, false);
  }
}

function checkSqlite(): CheckResult {
  let db: Database.Database | null = null;
  try {
    db = new Database(":memory:");
    const row = db.prepare<[], { ok: number }>("SELECT 1 AS ok").get();
    if (row?.ok !== 1) {
      return fail("SQLite/better-sqlite3", "smoke query returned an unexpected result");
    }
    return pass("SQLite/better-sqlite3", "in-memory query succeeded");
  } catch (err) {
    return fail("SQLite/better-sqlite3", errorMessage(err));
  } finally {
    db?.close();
  }
}

async function checkNetwork(label: string, url: string): Promise<CheckResult> {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { "user-agent": "peer-doctor/0.0.1" },
      signal: AbortSignal.timeout(8_000),
    });

    if (response.status >= 500) {
      return fail(`Network: ${label}`, `HTTP ${response.status}`);
    }

    return pass(`Network: ${label}`, `reachable (HTTP ${response.status})`);
  } catch (err) {
    return fail(`Network: ${label}`, errorMessage(err));
  }
}

async function checkProfHomeWritable(): Promise<CheckResult> {
  const home = paths.home();
  const testFile = path.join(home, `.doctor-${randomUUID()}`);

  try {
    await fs.mkdir(home, { recursive: true });
    await fs.writeFile(testFile, "ok", "utf8");
    await fs.unlink(testFile);
    return pass("~/.peer writable", home);
  } catch (err) {
    return fail("~/.peer writable", `${home}: ${errorMessage(err)}`);
  }
}

function checkSemanticScholarApiKey(): CheckResult {
  if (process.env.SEMANTIC_SCHOLAR_API_KEY) {
    return pass("SEMANTIC_SCHOLAR_API_KEY", "present", false);
  }
  return warn("SEMANTIC_SCHOLAR_API_KEY", "not set; lower Semantic Scholar rate limits", false);
}

function pass(label: string, message: string, required = true): CheckResult {
  return { label, message, required, status: "pass" };
}

function warn(label: string, message: string, required = true): CheckResult {
  return { label, message, required, status: "warn" };
}

function fail(label: string, message: string, required = true): CheckResult {
  return { label, message, required, status: "fail" };
}

function parseVersion(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    const diff = a[i]! - b[i]!;
    if (diff !== 0) return diff;
  }
  return 0;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
