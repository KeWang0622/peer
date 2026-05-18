-- prof v0.0.1 schema
-- L1: structural (citation graph)
-- L2: semantic (typed nodes/edges, LLM-extracted)
-- L4: action history (event log) - stub for v1.5

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ============================================================
-- L1 STRUCTURAL
-- ============================================================

CREATE TABLE IF NOT EXISTS papers (
  id              TEXT PRIMARY KEY,           -- our canonical id (hash)
  s2_id           TEXT UNIQUE,                -- Semantic Scholar paper id
  doi             TEXT,
  arxiv_id        TEXT,
  title           TEXT NOT NULL,
  abstract        TEXT,
  year            INTEGER,
  venue           TEXT,
  citations_count INTEGER DEFAULT 0,
  references_count INTEGER DEFAULT 0,
  pdf_path        TEXT,                       -- local cached PDF
  source          TEXT,                       -- 'semantic-scholar', 'arxiv', 'openalex'
  raw_json        TEXT,                       -- original API response
  ingested_at     INTEGER NOT NULL,
  layer2_extracted_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_papers_arxiv  ON papers(arxiv_id);
CREATE INDEX IF NOT EXISTS idx_papers_doi    ON papers(doi);
CREATE INDEX IF NOT EXISTS idx_papers_year   ON papers(year);
CREATE INDEX IF NOT EXISTS idx_papers_s2     ON papers(s2_id);

CREATE TABLE IF NOT EXISTS authors (
  id              TEXT PRIMARY KEY,           -- our canonical
  s2_author_id    TEXT UNIQUE,
  name            TEXT NOT NULL,
  h_index         INTEGER,
  affiliations    TEXT                        -- JSON array
);

CREATE TABLE IF NOT EXISTS authored (
  paper_id        TEXT NOT NULL,
  author_id       TEXT NOT NULL,
  position        INTEGER NOT NULL,           -- 1-indexed
  PRIMARY KEY (paper_id, author_id),
  FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES authors(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_authored_author ON authored(author_id);

CREATE TABLE IF NOT EXISTS cites (
  from_paper      TEXT NOT NULL,
  to_paper        TEXT NOT NULL,
  is_influential  INTEGER DEFAULT 0,          -- 0/1 boolean
  PRIMARY KEY (from_paper, to_paper),
  FOREIGN KEY (from_paper) REFERENCES papers(id) ON DELETE CASCADE,
  FOREIGN KEY (to_paper) REFERENCES papers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cites_to ON cites(to_paper);

-- ============================================================
-- L2 SEMANTIC
-- ============================================================

CREATE TABLE IF NOT EXISTS concepts (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,              -- canonical name
  aliases         TEXT,                       -- JSON array
  description     TEXT,
  first_paper     TEXT,                       -- paper that introduced it (if known)
  first_year      INTEGER,
  created_at      INTEGER NOT NULL,
  FOREIGN KEY (first_paper) REFERENCES papers(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_concepts_name ON concepts(name);

CREATE TABLE IF NOT EXISTS methods (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  category        TEXT,                       -- 'supervised'|'unsupervised'|'theory'|...
  description     TEXT,
  created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS datasets (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  modality        TEXT,                       -- 'text'|'image'|'video'|'multimodal'|...
  size_desc       TEXT,
  created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS metrics (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  direction       TEXT,                       -- 'higher_is_better'|'lower_is_better'
  created_at      INTEGER NOT NULL
);

-- Typed edges from papers to other nodes
CREATE TABLE IF NOT EXISTS paper_concepts (
  paper_id        TEXT NOT NULL,
  concept_id      TEXT NOT NULL,
  relation        TEXT NOT NULL,              -- 'introduces'|'uses'|'mentions'
  PRIMARY KEY (paper_id, concept_id, relation),
  FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE,
  FOREIGN KEY (concept_id) REFERENCES concepts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS paper_methods (
  paper_id        TEXT NOT NULL,
  method_id       TEXT NOT NULL,
  relation        TEXT NOT NULL,              -- 'introduces'|'uses'|'improves'
  PRIMARY KEY (paper_id, method_id, relation),
  FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE,
  FOREIGN KEY (method_id) REFERENCES methods(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS paper_datasets (
  paper_id        TEXT NOT NULL,
  dataset_id      TEXT NOT NULL,
  PRIMARY KEY (paper_id, dataset_id),
  FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE,
  FOREIGN KEY (dataset_id) REFERENCES datasets(id) ON DELETE CASCADE
);

-- Paper <-> paper semantic relations (different from L1 cites)
CREATE TABLE IF NOT EXISTS semantic_edges (
  from_paper      TEXT NOT NULL,
  to_paper        TEXT NOT NULL,
  type            TEXT NOT NULL,              -- 'improves_over'|'contrasts_with'|'builds_on'
  evidence        TEXT,                       -- quote / source
  created_at      INTEGER NOT NULL,
  PRIMARY KEY (from_paper, to_paper, type),
  FOREIGN KEY (from_paper) REFERENCES papers(id) ON DELETE CASCADE,
  FOREIGN KEY (to_paper) REFERENCES papers(id) ON DELETE CASCADE
);

-- ============================================================
-- L4 ACTION HISTORY (stub for v1.5)
-- ============================================================

CREATE TABLE IF NOT EXISTS actions (
  id              TEXT PRIMARY KEY,
  ts              INTEGER NOT NULL,
  type            TEXT NOT NULL,              -- 'paper_read'|'note_written'|...
  payload         TEXT NOT NULL,              -- JSON
  cost_usd        REAL,
  refs_papers     TEXT                        -- JSON array of paper ids
);

CREATE INDEX IF NOT EXISTS idx_actions_ts ON actions(ts);
CREATE INDEX IF NOT EXISTS idx_actions_type ON actions(type);

-- ============================================================
-- Meta / housekeeping
-- ============================================================

CREATE TABLE IF NOT EXISTS schema_version (
  version         INTEGER PRIMARY KEY,
  applied_at      INTEGER NOT NULL
);

INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (1, strftime('%s','now'));
