import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { paths, ensureDirs } from "../config/paths.js";

let _db: Database.Database | null = null;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function db(): Database.Database {
  if (_db) return _db;
  ensureDirs();
  const dbPath = paths.db();
  _db = new Database(dbPath);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  applySchema(_db);
  return _db;
}

function applySchema(d: Database.Database): void {
  const schemaPath = path.join(__dirname, "schema.sql");
  // schema.sql is shipped alongside compiled JS (copied during build)
  // Fall back to source location in dev
  let schemaSql: string;
  if (fs.existsSync(schemaPath)) {
    schemaSql = fs.readFileSync(schemaPath, "utf-8");
  } else {
    const devPath = path.join(__dirname, "..", "..", "src", "db", "schema.sql");
    schemaSql = fs.readFileSync(devPath, "utf-8");
  }
  d.exec(schemaSql);
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

// --- Typed row interfaces ---

export interface PaperRow {
  id: string;
  s2_id: string | null;
  doi: string | null;
  arxiv_id: string | null;
  title: string;
  abstract: string | null;
  year: number | null;
  venue: string | null;
  citations_count: number;
  references_count: number;
  pdf_path: string | null;
  source: string | null;
  raw_json: string | null;
  ingested_at: number;
  layer2_extracted_at: number | null;
}

export interface AuthorRow {
  id: string;
  s2_author_id: string | null;
  name: string;
  h_index: number | null;
  affiliations: string | null;
}

export interface ConceptRow {
  id: string;
  name: string;
  aliases: string | null;
  description: string | null;
  first_paper: string | null;
  first_year: number | null;
  created_at: number;
}

// --- Helpers ---

export function nowEpoch(): number {
  return Math.floor(Date.now() / 1000);
}

/** Stable canonical id for a paper: prefer arxiv_id, then doi, then s2_id, else title-hash */
export function paperCanonicalId(input: {
  arxiv_id?: string | null;
  doi?: string | null;
  s2_id?: string | null;
  title?: string | null;
  year?: number | null;
}): string {
  if (input.arxiv_id) return `arxiv:${input.arxiv_id}`;
  if (input.doi) return `doi:${input.doi.toLowerCase()}`;
  if (input.s2_id) return `s2:${input.s2_id}`;
  if (input.title) {
    const slug = input.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 60);
    return `t:${slug}:${input.year ?? 0}`;
  }
  throw new Error("paperCanonicalId: no identifiable field");
}

export function upsertPaper(p: Omit<PaperRow, "ingested_at" | "layer2_extracted_at"> & {
  ingested_at?: number;
}): void {
  const d = db();
  const stmt = d.prepare(`
    INSERT INTO papers (
      id, s2_id, doi, arxiv_id, title, abstract, year, venue,
      citations_count, references_count, pdf_path, source, raw_json, ingested_at
    ) VALUES (
      @id, @s2_id, @doi, @arxiv_id, @title, @abstract, @year, @venue,
      @citations_count, @references_count, @pdf_path, @source, @raw_json, @ingested_at
    )
    ON CONFLICT(id) DO UPDATE SET
      s2_id = COALESCE(excluded.s2_id, s2_id),
      doi = COALESCE(excluded.doi, doi),
      arxiv_id = COALESCE(excluded.arxiv_id, arxiv_id),
      title = excluded.title,
      abstract = COALESCE(excluded.abstract, abstract),
      year = COALESCE(excluded.year, year),
      venue = COALESCE(excluded.venue, venue),
      citations_count = MAX(excluded.citations_count, citations_count),
      references_count = MAX(excluded.references_count, references_count),
      raw_json = COALESCE(excluded.raw_json, raw_json)
  `);
  stmt.run({
    ...p,
    ingested_at: p.ingested_at ?? nowEpoch(),
  });
}

export function getPaper(id: string): PaperRow | undefined {
  return db().prepare<[string], PaperRow>("SELECT * FROM papers WHERE id = ?").get(id);
}

export function findPaperByArxiv(arxiv_id: string): PaperRow | undefined {
  return db().prepare<[string], PaperRow>("SELECT * FROM papers WHERE arxiv_id = ?").get(arxiv_id);
}

export function countPapers(): number {
  const row = db().prepare<[], { c: number }>("SELECT COUNT(*) as c FROM papers").get();
  return row?.c ?? 0;
}

export function countNotes(): number {
  try {
    const dir = paths.papersNotes();
    if (!fs.existsSync(dir)) return 0;
    return fs.readdirSync(dir).filter((f: string) => f.endsWith(".md")).length;
  } catch {
    return 0;
  }
}

export function runTransaction<T>(fn: () => T): T {
  return db().transaction(fn)();
}

export function normalizeSemanticName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function semanticNodeId(name: string): string {
  const normalized = normalizeSemanticName(name);
  if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized)) return normalized;
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

export function upsertAuthor(a: {
  s2_author_id: string | null;
  name: string;
  h_index?: number | null;
  affiliations?: string[] | null;
}): string {
  const id = a.s2_author_id ? `s2author:${a.s2_author_id}` : `author:${semanticNodeId(a.name)}`;
  db().prepare(`
    INSERT INTO authors (id, s2_author_id, name, h_index, affiliations)
    VALUES (@id, @s2_author_id, @name, @h_index, @affiliations)
    ON CONFLICT(id) DO UPDATE SET
      s2_author_id = COALESCE(excluded.s2_author_id, s2_author_id),
      name = excluded.name,
      h_index = COALESCE(excluded.h_index, h_index),
      affiliations = COALESCE(excluded.affiliations, affiliations)
  `).run({
    id,
    s2_author_id: a.s2_author_id,
    name: a.name.trim(),
    h_index: a.h_index ?? null,
    affiliations: JSON.stringify(a.affiliations ?? []),
  });
  return id;
}

export function upsertAuthored(input: { paper_id: string; author_id: string; position: number }): void {
  db().prepare(`
    INSERT OR REPLACE INTO authored (paper_id, author_id, position)
    VALUES (@paper_id, @author_id, @position)
  `).run(input);
}

export function upsertConcept(input: {
  name: string;
  paper_id: string;
  paper_year: number | null;
}): { id: string; relation: "introduces" | "mentions" } {
  const name = normalizeSemanticName(input.name);
  const id = semanticNodeId(name);
  const existing = db().prepare<[string], ConceptRow>("SELECT * FROM concepts WHERE id = ?").get(id);
  const now = nowEpoch();

  if (!existing) {
    db().prepare(`
      INSERT INTO concepts (id, name, aliases, description, first_paper, first_year, created_at)
      VALUES (@id, @name, @aliases, NULL, @first_paper, @first_year, @created_at)
    `).run({
      id,
      name,
      aliases: JSON.stringify([]),
      first_paper: input.paper_id,
      first_year: input.paper_year,
      created_at: now,
    });
    return { id, relation: "introduces" };
  }

  let relation: "introduces" | "mentions" = "mentions";
  const isSameFirstPaper = existing.first_paper === input.paper_id;
  const hasEarlierYear =
    input.paper_year != null && (existing.first_year == null || input.paper_year < existing.first_year);
  const isEarliestSeenYear =
    input.paper_year != null && existing.first_year != null && input.paper_year <= existing.first_year;

  if (hasEarlierYear) {
    db().prepare(`
      UPDATE concepts
      SET name = @name, first_paper = @first_paper, first_year = @first_year
      WHERE id = @id
    `).run({
      id,
      name,
      first_paper: input.paper_id,
      first_year: input.paper_year,
    });
    relation = "introduces";
  } else {
    db().prepare("UPDATE concepts SET name = ? WHERE id = ?").run(name, id);
    if (isEarliestSeenYear || (isSameFirstPaper && existing.first_year == null)) relation = "introduces";
  }

  return { id, relation };
}

export function linkPaperConcept(input: {
  paper_id: string;
  concept_id: string;
  relation: "introduces" | "uses" | "mentions";
}): void {
  db().prepare("DELETE FROM paper_concepts WHERE paper_id = ? AND concept_id = ?").run(input.paper_id, input.concept_id);
  db().prepare(`
    INSERT INTO paper_concepts (paper_id, concept_id, relation)
    VALUES (@paper_id, @concept_id, @relation)
  `).run(input);
}

export function upsertMethod(input: { name: string; category: string | null }): string {
  const name = input.name.trim().replace(/\s+/g, " ").slice(0, 80);
  const id = `method:${semanticNodeId(name)}`;
  db().prepare(`
    INSERT INTO methods (id, name, category, description, created_at)
    VALUES (@id, @name, @category, NULL, @created_at)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      category = COALESCE(excluded.category, category)
  `).run({
    id,
    name,
    category: input.category,
    created_at: nowEpoch(),
  });
  return id;
}

export function linkPaperMethod(input: { paper_id: string; method_id: string; relation: "uses" | "mentions" }): void {
  db().prepare("DELETE FROM paper_methods WHERE paper_id = ? AND method_id = ?").run(input.paper_id, input.method_id);
  db().prepare(`
    INSERT INTO paper_methods (paper_id, method_id, relation)
    VALUES (@paper_id, @method_id, @relation)
  `).run(input);
}

export function upsertDataset(input: { name: string; modality: string | null }): string {
  const name = input.name.trim().replace(/\s+/g, " ");
  const id = `dataset:${semanticNodeId(name)}`;
  db().prepare(`
    INSERT INTO datasets (id, name, modality, size_desc, created_at)
    VALUES (@id, @name, @modality, NULL, @created_at)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      modality = COALESCE(excluded.modality, modality)
  `).run({
    id,
    name,
    modality: input.modality,
    created_at: nowEpoch(),
  });
  return id;
}

export function linkPaperDataset(input: { paper_id: string; dataset_id: string }): void {
  db().prepare(`
    INSERT OR REPLACE INTO paper_datasets (paper_id, dataset_id)
    VALUES (@paper_id, @dataset_id)
  `).run(input);
}

export function upsertMetric(input: { name: string; direction?: string | null }): string {
  const name = input.name.trim().replace(/\s+/g, " ");
  const id = `metric:${semanticNodeId(name)}`;
  db().prepare(`
    INSERT INTO metrics (id, name, direction, created_at)
    VALUES (@id, @name, @direction, @created_at)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      direction = COALESCE(excluded.direction, direction)
  `).run({
    id,
    name,
    direction: input.direction ?? null,
    created_at: nowEpoch(),
  });
  return id;
}
