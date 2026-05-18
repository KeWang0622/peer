import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Override PROF_HOME before importing db
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "prof-test-"));
process.env.PROF_HOME = tmpHome;

const { upsertPaper, getPaper, paperCanonicalId, countPapers } = await import("../../src/db/client.ts");

test("paperCanonicalId prefers arxiv", () => {
  const id = paperCanonicalId({ arxiv_id: "2402.12345", doi: "10.0/foo" });
  assert.equal(id, "arxiv:2402.12345");
});

test("paperCanonicalId falls back to doi then s2 then title-hash", () => {
  assert.equal(paperCanonicalId({ doi: "10.0/foo" }), "doi:10.0/foo");
  assert.equal(paperCanonicalId({ s2_id: "abc123" }), "s2:abc123");
  const t = paperCanonicalId({ title: "Hello World", year: 2024 });
  assert.ok(t.startsWith("t:hello-world:2024"));
});

test("upsertPaper + getPaper round-trip", () => {
  const id = "arxiv:test123";
  upsertPaper({
    id,
    s2_id: null,
    doi: null,
    arxiv_id: "test123",
    title: "Test Paper",
    abstract: "abstract",
    year: 2024,
    venue: "ICLR",
    citations_count: 5,
    references_count: 10,
    pdf_path: null,
    source: "test",
    raw_json: null,
  });

  const got = getPaper(id);
  assert.ok(got);
  assert.equal(got?.title, "Test Paper");
  assert.equal(got?.arxiv_id, "test123");
  assert.equal(got?.citations_count, 5);
});

test("upsertPaper merges on conflict", () => {
  const id = "arxiv:merge-test";
  upsertPaper({
    id,
    s2_id: null,
    doi: null,
    arxiv_id: "merge-test",
    title: "T1",
    abstract: "a1",
    year: 2024,
    venue: null,
    citations_count: 1,
    references_count: 0,
    pdf_path: null,
    source: "test",
    raw_json: null,
  });

  upsertPaper({
    id,
    s2_id: "S2_ID",
    doi: null,
    arxiv_id: "merge-test",
    title: "T2",
    abstract: null, // should NOT clobber existing
    year: 2024,
    venue: null,
    citations_count: 10, // should take max
    references_count: 0,
    pdf_path: null,
    source: "test",
    raw_json: null,
  });

  const got = getPaper(id);
  assert.equal(got?.title, "T2");
  assert.equal(got?.abstract, "a1"); // preserved
  assert.equal(got?.s2_id, "S2_ID");
  assert.equal(got?.citations_count, 10);
});

test("countPapers reports correct total", () => {
  const n = countPapers();
  assert.ok(n >= 2);
});
