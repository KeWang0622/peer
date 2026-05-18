# prof

> Onboard your field in 10 minutes. Run your reading from one terminal forever.

![status](https://img.shields.io/badge/status-alpha-orange)
![node](https://img.shields.io/badge/node-22%2B-green)
![license](https://img.shields.io/badge/license-Apache--2.0-blue)

`prof` is a terminal-native research operating system. Built on [`pi-agent-core`](https://github.com/earendil-works/pi). Not a coding agent — a researcher's chief of staff.

```
$ prof map "mechanistic interpretability"

Mapping field: "mechanistic interpretability"
  · searching: Semantic Scholar
  · seeded: 87 papers found
  · embedding: 87 abstracts
  · clustering: into 4 subfields
  · analyzing: Identifying subfields and frontiers
  · naming: Asking model to name subareas
  · writing: Generating field overview narrative
  · problems: Identifying open problems
  · saving: ~/.prof/notes/fields/mechanistic-interpretability/

✓ Mapped "mechanistic interpretability" in 38.2s. Cost: $0.43

  87 papers · 4 subfields
  → ~/.prof/notes/fields/mechanistic-interpretability/
```

You get a `overview.md`, `reading-order.md`, `subfields.md`, `open-problems.md` you can read in any editor. **No web UI. No SaaS. Yours.**

## Install

```bash
npm install -g @kewang/prof
```

Set environment variables:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...           # for embeddings during `prof map`
# optional, higher rate limits:
export SEMANTIC_SCHOLAR_API_KEY=...
```

Run it:

```bash
prof map "your favorite topic"
```

## Commands

**v0.0.1-alpha ships exactly two commands.** Everything else is on the roadmap.

| Command | What | Status |
|---|---|---|
| `prof read <arxiv-id\|doi\|url>` | Deep-read one paper. Writes a structured markdown note + persists L1 (authors) + L2 (concepts, methods, datasets) graph. | ✅ shipping |
| `prof map "<topic>"` | Field overview + reading list. Searches Semantic Scholar, embeds abstracts, clusters into subareas, generates narrative. **Requires `OPENAI_API_KEY` for embeddings.** | ✅ shipping |
| `prof onboard` | Profile-driven library seeding from your Google Scholar / ORCID. | 🚧 v0.0.2 |
| `prof daily` | Today's top arxiv papers filtered to active projects. | 🚧 v0.0.2 |
| `prof ask "<question>"` | Q&A across your library + L1 graph. | 🚧 v0.0.2 |

## What you get

After running a few commands, `~/.prof/` looks like:

```
~/.prof/
├── prof.db                          # local SQLite knowledge graph (L1+L2)
├── notes/
│   ├── papers/                      # one Obsidian-compatible .md per paper read
│   ├── fields/                      # output of `prof map`
│   │   └── mechanistic-interpretability/
│   │       ├── overview.md
│   │       ├── reading-order.md
│   │       ├── subfields.md
│   │       └── open-problems.md
│   ├── concepts/                    # (v1.5) one per concept
│   └── ideas/                       # your raw ideas, your wikilinks
```

You can open `~/.prof/notes/` in [Obsidian](https://obsidian.md) and it just works — all notes use `[[wikilinks]]`.

## Why not just Claude Code with plugins

| | Claude Code + plugins | prof |
|---|---|---|
| Default tools | `read/write/edit/bash` | research tools, no `bash` |
| Memory | per-session | persistent 4-layer graph |
| Onboarding | none | learns YOUR field from YOUR publications |
| Output | diffs / code | papers / notes / citations / field maps |
| Schema | none | typed nodes: Paper / Concept / Method / Dataset |

Plugins don't share a brain. `prof` has one.

## Architecture (short version)

Four layers, one SQLite file:

- **L1 Structural**: papers ↔ papers via citations (Semantic Scholar + OpenAlex)
- **L2 Semantic**: typed nodes & edges, extracted by Claude
- **L3 Personal**: your markdown notes, Obsidian-compatible
- **L4 Action history**: every command you ran, queryable _(v1.5)_

More details in [docs/architecture.md](docs/architecture.md) (v0.0.2).

## Costs

| Operation | Approx cost |
|---|---|
| `prof read <paper>` | ~$0.01 |
| `prof map "<topic>"` | ~$0.40 |
| `prof onboard` (one-time) | ~$1.20 |

You pay your provider directly. No middle-man billing.

## Status

`v0.0.1-alpha`. Pre-PMF. Built in one night by Claude Code + Codex on a [pi](https://github.com/earendil-works/pi) substrate. Expect rough edges. File issues.

## License

Apache 2.0 © Ke Wang
