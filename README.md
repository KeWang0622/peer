<div align="center">

# peer

### a **research agent** that lives in your terminal

*A local research agent for PhDs: maps fields, reads papers, checks citations, and compounds your library in `~/.peer/`.*

![status](https://img.shields.io/badge/status-alpha-orange)
![node](https://img.shields.io/badge/node-22%2B-green)
![license](https://img.shields.io/badge/license-Apache--2.0-blue)
![commands](https://img.shields.io/badge/commands-18-blue)
![agent](https://img.shields.io/badge/type-AI%20agent-purple)
![sandboxed](https://img.shields.io/badge/sandbox-no%20bash-success)
![pi-agent-core](https://img.shields.io/badge/built%20on-pi--agent--core-black)

🌐 **[peer-research.pika.me](https://peer-research.pika.me)** &nbsp;·&nbsp; **Local-first · BYOK · Apache 2.0**

<img src="docs/images/demo.gif" alt="peer mapping the diffusion-alignment field in 38 seconds" width="100%"/>

*18s · cinematic · what `peer map "diffusion alignment"` actually looks like*

</div>

---

## one-line install

```bash
curl -fsSL https://raw.githubusercontent.com/KeWang0622/peer/main/scripts/install/install.sh | sh
```

Then `peer doctor` → `peer onboard` and you're on the journey. See [Install](#install) for keys.

---

## What is peer?

> The agent owns the loop. You own the data. The graph compounds.

**peer is an AI research agent — not a wrapper around a chat box, and not a coding agent.** It plans, picks tools, runs them, reads results, decides what's next, persists what it learns, and continues across sessions. Built on [`pi-agent-core`](https://github.com/earendil-works/pi) with 17 research tools registered.

You talk to it like you'd talk to a smart labmate. It uses tools like you'd use a browser tab — except the browser tab **remembers every paper you've ever read**, can **map an entire field in 38 seconds**, and **finds gaps in the literature while you sleep**.

**peer calibrates to your role**: PhD student, postdoc, faculty, industry researcher, or independent learner. The agent adapts its language and recommendations to where you actually are.

---

## See it think

```text
$ peer shell
welcome to peer — your research agent · 60-second setup

What should I call you?  ▸ Ke
What's your role?
  1. PhD student     2. Postdoc     3. Faculty
  4. Industry        5. Independent
                          ▸ 1
What's your research area?  ▸ diffusion alignment

(then, naturally:)

you ❯ what should I read first?

peer ✦ thinking…
peer ✦ For diffusion alignment, start with the DPO paper (arxiv:2305.18290).
        It introduces preference learning without explicit RL. Solid foundation.
        Want me to map the field and pull a tiered reading list?

you ❯ yes

peer ✦ ▸ map_field topic="diffusion alignment"
        ⠋ searching Semantic Scholar     · 12s
        ⠋ clustering 41 papers           · 22s
        ⠋ writing field overview         · 38s
        ✓ 41 papers · 3 subfields · $0.05  → ~/.peer/notes/fields/diffusion-alignment/

peer ✦ Done. Top 5 to read in order:
          1. DPO (arxiv:2305.18290)               — foundational
          2. RLHF (arxiv:2203.02155)              — methodology root
          3. Constitutional AI (arxiv:2212.08073) — alignment branch
          4. ...

        Reading trail saved. `peer next` continues from here.
        Want me to deep-read DPO into your library now?
```

That's the **whole agent loop**: a tool call, a real result, a follow-up suggestion, and state that compounds. Try it. Five minutes.

---

## Why this is an agent (and not "another AI tool")

Most "research AI" products are pretty UIs over a single LLM call. peer is built differently:

| | peer (agent) | Most research AI tools |
|---|---|---|
| Planning | ✓ multi-step task plans | ✗ single-shot prompt |
| Tool use | ✓ 17 tools, agent chooses | ✗ fixed prompts |
| Memory | ✓ 4-layer knowledge graph that compounds across years | ✗ session-only |
| Autonomy | ✓ runs to completion, asks for confirmation only at branch points | ✗ ask → answer → forget |
| Citations | ✓ cross-checked against your local graph | ✗ often hallucinated |
| Where it runs | ✓ in YOUR terminal, with YOUR keys, on YOUR files | ✗ their cloud |

peer is built on [`pi-agent-core`](https://github.com/earendil-works/pi) — a minimal extensible agent runtime. The same substrate used for coding agents, except here every tool is research-shaped: `map_field`, `find_gap`, `cite_check`, `read_paper`, `collab_search`, …

---

<div align="center">
<img src="docs/images/graph.jpg" alt="peer's compounding knowledge graph" width="100%"/>

*Your library, growing with every paper. peer reads it before answering.*
</div>

---

## Install

**One line** (recommended):

```bash
curl -fsSL https://raw.githubusercontent.com/KeWang0622/peer/main/scripts/install/install.sh | sh
```

The script checks Node ≥22, clones into `~/.peer-src`, builds, runs `npm link`, and runs `peer doctor`. Read it first if you don't trust strangers piping into sh ([source](scripts/install/install.sh)).

**Or manually:**

```bash
git clone https://github.com/KeWang0622/peer.git
cd peer && npm install && npm run build && npm link
```

Set your keys (BYOK — your library, your money, your data):

```bash
export ANTHROPIC_API_KEY=sk-ant-...    # required: the agent's brain
export OPENAI_API_KEY=sk-...           # required: embeddings for ask/map
export SEMANTIC_SCHOLAR_API_KEY=...    # optional: higher S2 rate limits
```

Verify everything is healthy:

```bash
peer doctor
```

Then go on the journey:

```bash
peer onboard
```

> npm publish coming soon under `@kewang/peer`. Watch the repo for the release tag.

---

## The 18 agent tools, by stage of your research journey

### orient — where am I?

| Command | The agent does this for you |
|---|---|
| `peer onboard` | Day 1. Tell peer your Google Scholar URL or 5 arxiv IDs. Seeds your library. |
| `peer map "<topic>"` | Walking into a new field cold. **38s · ~$0.05** for a PhD-quality map. |
| `peer daily` | Morning ritual. Today's top arxiv papers, ranked by what's in your library. |

### think — what should I work on?

| Command | The agent does this for you |
|---|---|
| `peer brainstorm "<vague idea>"` | Half-formed thought → 3 framings + 5 adjacent angles. |
| `peer gap "<X> and <Y>"` | Looking for a thesis. Finds sparse intersections + concrete questions. |
| `peer next "<goal>"` | "What should I read next toward X?" Picks one + alternates. Persists as a trail. |

### read — going deep

| Command | The agent does this for you |
|---|---|
| `peer read <arxiv-id>` | A paper matters. Deep-read → structured Obsidian note + graph edges. |
| `peer ask "<question>"` | "What did I actually believe about X?" Cited Q&A across your library. |
| `peer compare <id1> <id2>` | Two papers in your tabs. Side-by-side: shared assumptions, real differences. |

### publish — putting words on paper

| Command | The agent does this for you |
|---|---|
| `peer cite "<claim>"` | Writing the intro, need 3 citations. Returns BibTeX + `\cite{...}`. |
| `peer relwork "<topic>"` | Drafting Related Work. Thematic groups, not a bullet dump. |
| `peer outline "<topic>"` | Sketching a paper. Title, abstract, 7 sections, citations needed. |

### share — finding your people

| Command | The agent does this for you |
|---|---|
| `peer collab "<topic\|author>"` | Looking for collaborators or labs. Active researchers ranked by recency. |
| `peer graph` | Show me my journey. D3 force-directed knowledge graph in the browser. |
| `peer share "<topic>"` | Export a beautiful HTML card from a field map. Tweetable, no private notes. |

### reflect — the journey log

| Command | The agent does this for you |
|---|---|
| `peer journal` | Friday evening, what did I learn this week. Markdown diary. |
| `peer history` | Where have I been? Recent reads + library size + spend. |
| `peer doctor` | Things feel slow. Preflight: keys, node, sqlite, network. |

---

## Where you are vs. what to run

| Stage | The command you reach for most |
|---|---|
| First-year, lost | `peer brainstorm`, `peer map`, `peer onboard` |
| Building first library | `peer daily`, `peer read`, `peer history` |
| Picking a thesis | `peer gap`, `peer brainstorm`, `peer collab` |
| Writing your first paper | `peer outline`, `peer relwork`, `peer cite`, `peer ask` |
| Defending the thesis | `peer graph`, `peer history`, `peer relwork` |
| Postdoc / faculty | `peer collab`, `peer daily`, `peer relwork` for grants |

---

## What you get on disk

Everything is local. One folder. Open it in [Obsidian](https://obsidian.md) and it just works.

```
~/.peer/
├── peer.db                      # SQLite knowledge graph (L1+L2)
├── profile.md                   # who you are (role-aware persona)
├── notes/
│   ├── papers/                  # one Obsidian-compat .md per paper
│   ├── fields/                  # output of peer map
│   ├── concepts/                # named concepts (v0.0.2)
│   ├── journal.md               # your research diary
│   └── graph.html               # interactive D3 graph
```

Wikilinks `[[like this]]` between papers and concepts. Your graph grows for years.

---

## How the agent actually works

```
        ┌────────────────────────────────────────────────────────┐
        │                     peer (agent)                       │
        │                                                        │
        │   ┌──────────────────────────────────────────────┐    │
        │   │  Anthropic Claude — planner + tool selector  │    │
        │   └──────────────────────────────────────────────┘    │
        │                       │                                │
        │   ┌───────────────────┴───────────────────────────┐   │
        │   │            17 research tools                   │   │
        │   │  map_field  find_gap  read_paper  cite_check   │   │
        │   │  ask_library  brainstorm  compare  outline …   │   │
        │   └───────────────────┬───────────────────────────┘   │
        │                       │                                │
        │   ┌───────────────────┴───────────────────────────┐   │
        │   │  4-layer knowledge graph (SQLite + embeddings) │   │
        │   │  L1 citations · L2 semantic · L3 your notes ·  │   │
        │   │  L4 action history                             │   │
        │   └───────────────────────────────────────────────┘   │
        │                                                        │
        └────────────────────────────────────────────────────────┘
                            ↑
                  built on pi-agent-core
                  (minimal extensible runtime)
```

The agent owns the loop. You own the data. The graph compounds.

---

## How peer fits next to the tools you already know

This is the honest version. Other tools are good at what they do — peer just sits in a different spot.

| | **peer** | Elicit | ResearchRabbit | Claude Code |
|---|---|---|---|---|
| Primary surface | terminal | web | web | terminal |
| Cited Q&A over your own library | ✓ | ✓ | – | partial |
| Visual citation/co-citation graphs | ✓ (D3, local) | – | ✓ (great) | – |
| Field maps with narrative + tiered reading list | ✓ | partial | – | – |
| Gap-finding across topic pairs | ✓ | – | – | – |
| Compounding knowledge graph across years | ✓ (SQLite, local) | partial | partial | – |
| Local-first, files in plain Markdown | ✓ | – | – | ✓ |
| BYOK (your keys, your spend) | ✓ | – | – | ✓ |
| Built as an agent (plan → tools → memory) | ✓ (research) | – | – | ✓ (coding) |
| BibTeX + drafting helpers | ✓ | partial | – | partial |

The closest sibling is Claude Code — *peer is what that idea looks like when the tools are research tools instead of coding tools.*

---

## Day 1 → Day 30: what your week with peer looks like

| When | What you run | What you get |
|---|---|---|
| **Day 1** | `peer onboard` then `peer map "<your area>"` | Profile + 40-paper field overview + tiered reading list |
| **Day 2-7** | `peer daily` every morning · `peer read <id>` for hits | Personalized arxiv feed + 5-10 deeply-read papers in your graph |
| **Day 7** | `peer ask "what do I actually know about X?"` | Cited Q&A grounded in YOUR library — a real epistemic mirror |
| **Day 14** | `peer gap "<X> and <Y>"` · `peer brainstorm "<idea>"` | Sparse intersections + 3 framings for your next direction |
| **Day 21** | `peer outline "<topic>"` · `peer cite "<claim>"` | Paper outline with citations needed + BibTeX |
| **Day 30** | `peer graph` · `peer history` · `peer journal` | A D3 graph of the field you've internalized + spend log + diary |

You don't have to follow this. The agent just shows up where you are.

---

## Cost model (real numbers — run `peer history` for your live spend)

| Operation | Approx cost |
|---|---|
| `peer read <paper>` | ~$0.01 |
| `peer daily` | ~$0.01 |
| `peer ask "..."` | ~$0.01 |
| `peer cite "..."` | ~$0.02 |
| `peer map "<topic>"` | ~$0.05 (one-time per field) |
| `peer onboard` | ~$1.20 (one-time) |
| `peer relwork "<topic>"` | ~$0.05 |
| `peer outline "<topic>"` | ~$0.03 |

You pay your provider directly. Run `peer history` to track spend.

---

## Status

`v0.0.1-alpha.11` · pre-PMF · iterating in public on the [pi-agent-core](https://github.com/earendil-works/pi) substrate. Expect rough edges and breaking changes between alpha tags. File issues — they're how the agent learns who's using it.

### Safety model

The agent runs **sandboxed**: read/write/edit/grep/find/ls only, and all file paths are jailed to your peer home directory (`~/.peer/` by default, or `$PEER_HOME`). It has **no shell/bash tool**. The agent cannot reach your `~/.ssh/`, your dotfiles, or anything outside its own folder.

### What's missing (v0.0.2 backlog)

- Full-PDF parsing (`peer read --full`) — currently abstracts only
- Persistent embedding cache (sqlite-vec) — currently re-embeds every call
- Tests for the newer commands (cite, gap, compare, outline, relwork, brainstorm, collab)
- Zotero / BibTeX library import
- npm-published binary (`npm install -g @kewang/peer`)

### Roadmap

- **v0.0.2** — polish & integrity: PDF parse, embed cache, npm publish, more tests
- **v0.1** — collaboration: `peer watch`, `peer export`, Zotero sync, `peer rebuttal`
- **v1.0** — the OS: shell mode (✓), voice mode, web companion, multi-language papers

---

## Contributing

This repo is being shipped in public. PRs welcome — especially:
- Researchers across disciplines wanting role-specific persona tweaks
- New tools (`peer ____` ideas)
- Zotero / BibTeX importers
- LaTeX exporters

---

## License

Apache 2.0 © Ke Wang. Free, forever.

---

<div align="center">

**Research is a journey.**
*May yours be a good one.*

</div>
