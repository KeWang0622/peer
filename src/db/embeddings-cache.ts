/**
 * Persistent embedding cache backed by SQLite.
 *
 * Keyed by (subject_type, subject_id, model). content_hash is sha256
 * of the input text — invalidates the cache automatically if the source
 * changed.
 */
import { createHash } from "node:crypto";
import { db } from "./client.js";
import { embed, MODELS } from "../lib/llm.js";

export type SubjectType = "paper-title-abstract" | "concept" | "query" | "note";

function vectorToBlob(v: number[]): Buffer {
  const buf = Buffer.alloc(v.length * 4);
  for (let i = 0; i < v.length; i++) buf.writeFloatLE(v[i] ?? 0, i * 4);
  return buf;
}

function blobToVector(buf: Buffer): number[] {
  const out: number[] = new Array(buf.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = buf.readFloatLE(i * 4);
  return out;
}

function hash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 32);
}

interface CachedRow {
  vector: Buffer;
  content_hash: string;
}

/** Look up cached embedding. Returns null on miss or hash mismatch. */
export function lookup(
  subjectType: SubjectType,
  subjectId: string,
  text: string,
  model: string = MODELS.embed,
): number[] | null {
  const row = db()
    .prepare<[string, string, string], CachedRow>(
      "SELECT vector, content_hash FROM embeddings WHERE subject_type = ? AND subject_id = ? AND model = ?",
    )
    .get(subjectType, subjectId, model);
  if (!row) return null;
  if (row.content_hash !== hash(text)) return null;
  return blobToVector(row.vector);
}

/** Store/overwrite an embedding. */
export function store(
  subjectType: SubjectType,
  subjectId: string,
  text: string,
  vector: number[],
  model: string = MODELS.embed,
): void {
  db()
    .prepare(
      `INSERT INTO embeddings (subject_type, subject_id, model, content_hash, vector, created_at)
       VALUES (@subject_type, @subject_id, @model, @content_hash, @vector, @created_at)
       ON CONFLICT(subject_type, subject_id, model) DO UPDATE SET
         content_hash = excluded.content_hash,
         vector = excluded.vector,
         created_at = excluded.created_at`,
    )
    .run({
      subject_type: subjectType,
      subject_id: subjectId,
      model,
      content_hash: hash(text),
      vector: vectorToBlob(vector),
      created_at: Math.floor(Date.now() / 1000),
    });
}

/** Embed a batch of (id, text) pairs, using cache where possible. */
export async function embedCached(
  subjectType: SubjectType,
  items: Array<{ id: string; text: string }>,
  model: string = MODELS.embed,
): Promise<Map<string, number[]>> {
  const result = new Map<string, number[]>();
  const misses: Array<{ id: string; text: string; idx: number }> = [];

  // Check cache for each item
  items.forEach((item, idx) => {
    const cached = lookup(subjectType, item.id, item.text, model);
    if (cached) {
      result.set(item.id, cached);
    } else {
      misses.push({ ...item, idx });
    }
  });

  if (misses.length === 0) return result;

  // Batch the misses
  const texts = misses.map((m) => m.text);
  const { vectors } = await embed(texts);
  if (vectors.length !== misses.length) {
    throw new Error(`embed returned ${vectors.length} vectors for ${misses.length} requests`);
  }

  for (let i = 0; i < misses.length; i++) {
    const m = misses[i]!;
    const v = vectors[i]!;
    store(subjectType, m.id, m.text, v, model);
    result.set(m.id, v);
  }

  return result;
}

/** Embed a single query (or any one-off text); cached by content hash. */
export async function embedOneCached(
  subjectType: SubjectType,
  subjectId: string,
  text: string,
  model: string = MODELS.embed,
): Promise<number[]> {
  const cached = lookup(subjectType, subjectId, text, model);
  if (cached) return cached;
  const { vectors } = await embed([text]);
  const v = vectors[0]!;
  store(subjectType, subjectId, text, v, model);
  return v;
}

export function countCached(subjectType?: SubjectType): number {
  if (subjectType) {
    return (
      db().prepare<[string], { c: number }>(
        "SELECT COUNT(*) as c FROM embeddings WHERE subject_type = ?",
      ).get(subjectType)?.c ?? 0
    );
  }
  return db().prepare<[], { c: number }>("SELECT COUNT(*) as c FROM embeddings").get()?.c ?? 0;
}
