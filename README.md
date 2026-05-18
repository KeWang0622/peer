# prof

> Research is a journey.
>
> `prof` is your terminal companion for it — from the first day you don't know what to research, to your defense.

![status](https://img.shields.io/badge/status-alpha-orange)
![node](https://img.shields.io/badge/node-22%2B-green)
![license](https://img.shields.io/badge/license-Apache--2.0-blue)
![commands](https://img.shields.io/badge/commands-17-blue)

Built on [`pi-agent-core`](https://github.com/earendil-works/pi). Local-first. BYOK. Apache 2.0.

```
$ prof map "mechanistic interpretability"

Mapping field: "mechanistic interpretability"
  · searching: Semantic Scholar
  · seeded: 41 papers found
  · clustering: into 3 subfields
  · writing: Generating field overview narrative

✓ Mapped in 38s. Cost: $0.05

  41 papers · 3 subfields
  → ~/.prof/notes/fields/mechanistic-interpretability/

Try: cat ~/.prof/notes/fields/mechanistic-interpretability/overview.md
```

The output is a 2000-word PhD-quality field overview, a tiered reading list, identified subfields, and open problems. **In 38 seconds, for $0.05.**

---

## Install

```bash
npm install -g @kewang/prof
```

Set your keys (BYOK):

```bash
export ANTHROPIC_API_KEY=sk-ant-...    # required: the brain
export OPENAI_API_KEY=sk-...           # required: embeddings for map/ask
# optional, higher S2 rate limits:
export SEMANTIC_SCHOLAR_API_KEY=...
```

Verify:

```bash
prof doctor
```

Then go on the journey:

```bash
prof onboard
```

---

## The 17 commands, by stage of your research journey

### orient — where am I?

| Command | Use when |
|---|---|
| `prof onboard` | Day 1. Tell prof your Google Scholar URL or paste 5 arxiv IDs. It seeds your library. |
| `prof map "<topic>"` | Walking into a new area cold. Get a PhD-quality field map in 5 minutes. |
| `prof daily` | Morning ritual. Today's top arxiv papers, ranked by what's in your library. |

### think — what should I work on?

| Command | Use when |
|---|---|
| `prof brainstorm "<vague idea>"` | You have a half-formed thought. Expand into 3 framings + 5 adjacent angles. |
| `prof gap "<X> and <Y>"` | Looking for a thesis topic. Find sparse intersections + concrete questions. |
| `prof next "<goal>"` | "What should I read next toward X?" Picks one paper + alternates. Persists as a trail — re-run to continue. |

### read — going deep

| Command | Use when |
|---|---|
| `prof read <arxiv-id>` | A paper matters. Deep-read into a structured Obsidian-compatible note + L1+L2 graph. |
| `prof ask "<question>"` | "What did I actually believe about X?" — cited Q&A over your library. |
| `prof compare <id1> <id2>` | Two papers in your tabs. Side-by-side: shared assumptions, real differences, when to use which. |

### publish — putting words on paper

| Command | Use when |
|---|---|
| `prof cite "<claim>"` | Writing the intro, need 3 citations to back this sentence. Returns BibTeX + `\cite{...}`. |
| `prof relwork "<topic>"` | Drafting Related Work. Clusters your library + recent literature into thematic groups. |
| `prof outline "<topic>"` | Sketching a paper. Title, abstract, 7 sections with bullet points, citations needed. |

### share — finding your people

| Command | Use when |
|---|---|
| `prof collab "<topic\|author>"` | Looking for collaborators or labs. Active researchers ranked by recent papers. |
| `prof graph` | Show me my journey. D3 force-directed knowledge graph in the browser. |

### reflect — the journey log

| Command | Use when |
|---|---|
| `prof journal` | Friday evening, what did I learn this week. Markdown diary in `~/.prof/notes/journal.md`. |
| `prof history` | Where have I been? Recent reads + library size + spend. |
| `prof doctor` | Things feel slow. Preflight: keys, node, sqlite, network. |

---

## Where you are vs. what to run

| Stage | The command you reach for most |
|---|---|
| First-year, lost | `prof brainstorm`, `prof map`, `prof onboard` |
| Building first library | `prof daily`, `prof read`, `prof history` |
| Picking a thesis | `prof gap`, `prof brainstorm`, `prof collab` |
| Writing your first paper | `prof outline`, `prof relwork`, `prof cite`, `prof ask` |
| Defending the thesis | `prof graph`, `prof history`, `prof relwork` |
| Postdoc / faculty | `prof collab`, `prof daily`, `prof relwork` for grants |

---

## What you get on disk

Everything is local. One folder. Open it in [Obsidian](https://obsidian.md) and it just works.

```
~/.prof/
├── prof.db                      # SQLite knowledge graph (L1+L2)
├── profile.md                   # who you are (from onboard)
├── notes/
│   ├── papers/                  # one Obsidian-compat .md per paper
│   ├── fields/                  # output of prof map
│   ├── concepts/                # named concepts (v0.0.2)
│   ├── journal.md               # your research diary
│   └── graph.html               # interactive D3 graph
```

Wikilinks `[[like this]]` between papers and concepts.

---

## Why prof is different

This is not Claude Code with a research preset. The schema is the product:

- **4-layer knowledge graph that compounds over years**, not single-session memory
- **Onboarding learns YOUR field** from YOUR publications, not anonymous topics
- **Citations are cross-checked against the local graph** before output — no hallucinations
- **Local-first, BYOK** — your library, your money, your data
- **Terminal-native** — not a web app

| | prof | Elicit | ResearchRabbit | Notion AI | Claude Code |
|---|---|---|---|---|---|
| Compounding library | ✓ | partial | partial | – | – |
| Cited Q&A | ✓ | ✓ | – | partial | partial |
| Field maps with narrative | ✓ | – | – | – | – |
| Local, BYOK | ✓ | – | – | – | partial |
| Terminal | ✓ | – | – | – | ✓ |
| Knowledge graph viz | ✓ | – | partial | – | – |
| Drafting + BibTeX | ✓ | partial | – | – | partial |

---

## Cost model (real numbers, May 2026)

| Operation | Approx cost |
|---|---|
| `prof read <paper>` | ~$0.01 |
| `prof daily` | ~$0.01 |
| `prof ask "..."` | ~$0.01 |
| `prof cite "..."` | ~$0.02 |
| `prof map "<topic>"` | ~$0.05 (one-time per field) |
| `prof onboard` | ~$1.20 (one-time) |
| `prof relwork "<topic>"` | ~$0.05 |
| `prof outline "<topic>"` | ~$0.03 |

You pay your provider directly. Run `prof history` to track spend.

---

## Status

`v0.0.1-alpha.5`. Pre-PMF. Built in one night by Claude Code + Codex on a [pi-agent-core](https://github.com/earendil-works/pi) substrate. Expect rough edges. File issues with love.

### What's missing (v0.0.2 backlog)

- Full-PDF parsing (`prof read --full` flag) — currently we only read abstracts
- Persistent embedding cache (sqlite-vec) — currently re-embeds every call
- Tests for the newer commands (cite, gap, compare, outline, relwork, brainstorm, collab)
- Full `AgentTool[]` registration when used as a pi extension
- Zotero / BibTeX library import
- Interactive REPL shell (`prof shell`)
- Voice mode via OpenAI Realtime

### Roadmap

- **v0.0.2** — the polish & integrity release: PDF parse, embed cache, full pi extension, tests
- **v0.1** — collaboration: `prof watch`, `prof export`, Zotero sync, `prof rebuttal`
- **v1.0** — the OS: shell mode, voice mode, web companion, multi-language papers

---

## License

Apache 2.0 © Ke Wang. Free, forever.

---

> Research is a journey. May yours be a good one.
