# prof — architecture

A short overview. v0.0.1-alpha.

## The 4-layer knowledge graph

```
┌─────────────────────────────────────────────────────────┐
│  L4  ACTION HISTORY                                      │
│      every command run logged for compounding context   │
│      (scaffolded; not yet populated in v0.0.1)          │
├─────────────────────────────────────────────────────────┤
│  L3  PERSONAL NOTES                                      │
│      Obsidian-compatible markdown                        │
│      ~/.prof/notes/{papers,concepts,fields,ideas}/      │
├─────────────────────────────────────────────────────────┤
│  L2  SEMANTIC GRAPH                                      │
│      typed nodes: Paper / Concept / Method / Dataset    │
│      typed edges: introduces, uses, mentions, ...       │
│      populated by LLM extraction from PDFs/abstracts    │
├─────────────────────────────────────────────────────────┤
│  L1  CITATION GRAPH                                      │
│      papers ↔ papers ↔ authors                          │
│      source: Semantic Scholar Graph API + OpenAlex      │
├─────────────────────────────────────────────────────────┤
│  pi-agent-core    event loop + tool dispatch             │
└─────────────────────────────────────────────────────────┘
```

## Storage

Everything is local. One folder, one SQLite file, plus markdown.

```
~/.prof/
├── prof.db                 SQLite, L1+L2+L4 tables
├── notes/
│   ├── papers/             one Obsidian-compat .md per paper read
│   ├── fields/             output of `prof map`
│   ├── concepts/           (v0.0.2)
│   └── ideas/              (v0.0.2)
├── profile.md              (v0.0.2)
└── pdf-cache/              (v0.0.2)
```

## Data flow: `prof read`

```
input "2402.04494" or arxiv URL or DOI
  ↓ resolveIdentifier
arxiv id "2402.04494"
  ↓ Semantic Scholar getPaper (DOI:.., arXiv:..)
S2Paper metadata
  ↓ fallback: arXiv API getById   if S2 didn't have abstract
ArxivEntry { title, summary, authors, ... }
  ↓ paperCanonicalId
"arxiv:2402.04494"
  ↓ upsertPaper                   L1 write
papers row
  ↓ Claude Sonnet extraction prompt
{contribution, method, datasets, metrics, key_innovation, concepts}
  ↓ persistReadGraph (SQLite transaction)
   - upsertAuthor + upsertAuthored
   - upsertConcept + linkPaperConcept
   - upsertMethod  + linkPaperMethod
   - upsertDataset + linkPaperDataset
   - upsertMetric
  ↓ formatNote (YAML frontmatter + body)
~/.prof/notes/papers/<slug>.md
```

## Data flow: `prof map`

```
"mechanistic interpretability"
  ↓ S2 searchPapers, limit 100
~50-100 abstracts
  ↓ OpenAI text-embedding-3-small (one batch)
1536-dim vectors
  ↓ agglomerative clustering, k = suggestedK(N)
cluster labels
  ↓ per cluster: centroid paper, foundational (most cited), frontier (most recent)
subfield structures
  ↓ Claude Haiku: name each cluster from titles
named subfields
  ↓ Claude Sonnet: narrative generation
overview.md (1500-2000 words, [[wikilinks]] to real papers)
  ↓ Claude Sonnet: open problems pass
open-problems.md
  ↓ write reading-order.md + subfields.md + papers.json
~/.prof/notes/fields/<slug>/
```

## Cost model

| Operation | Approx tokens | Approx cost |
|---|---|---|
| `prof read <paper>` | 1500 in + 600 out, Sonnet | ~$0.01 |
| `prof map "<topic>"` | 80 papers × 200 tokens embed + 12k Sonnet | ~$0.40 |

You pay the LLM/embedding providers directly. No middleman.

## Why pi-agent-core?

We get for free:
- Tool calling loop
- Streaming event bus
- Session management
- Multi-provider LLM support
- Steering / follow-up queues

We add:
- 13 research-native tools (read_paper, search_papers, etc.)
- 4-layer knowledge graph
- Research persona system prompt
- Two CLI commands (`prof read`, `prof map`)

`prof` can be installed standalone (`npm install -g @kewang/prof`) or as a pi extension (`pi install @kewang/prof`). The same code powers both.

## Not in v0.0.1

- pi extension registers commands but does NOT yet register the full AgentTool[] set
- L4 action history table exists but no commands populate it yet
- No sqlite-vec embedding storage (uses ephemeral embeddings during `prof map`)
- No OpenAlex fallback (S2 primary only)
- No `prof onboard` for personalized library seeding
- No PDF parsing (`--full` flag deferred — abstract-only by default)

All these land in v0.0.2 and beyond.
