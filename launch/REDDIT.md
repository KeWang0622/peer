# r/PhD

Title: I built a terminal research agent for the parts of PhD work between papers

I am the builder of `peer`, an alpha CLI for research workflows. It is aimed at the messy parts of PhD work that sit between "find papers" and "write the thesis": mapping a new field, turning papers into notes, asking cited questions over your own library, finding gaps between topics, and keeping a record of what you have already read.

The current install is from source, so this is not polished yet. You run commands like `peer onboard`, `peer map "<topic>"`, `peer read <arxiv-id>`, `peer ask "<question>"`, and `peer journal`. It stores local Markdown notes and a SQLite graph under `~/.peer/`, with BYOK API keys.

I would especially like feedback from PhD students on whether the role-aware onboarding and "what should I read next?" flow match how early-stage research actually feels.

# r/MachineLearning

Title: Alpha research agent CLI built on a local paper graph

I have been building `peer`, a terminal-native research agent for ML researchers. The technical idea is to make the agent loop research-shaped rather than chat-shaped: Claude plans and selects tools, while the local state is a 4-layer graph with citations, semantic embeddings, notes, and action history.

The README lists 17 commands/tools, including `peer map`, `peer read`, `peer ask`, `peer compare`, `peer gap`, `peer cite`, `peer relwork`, and `peer collab`. The demo path maps "diffusion alignment" into 41 papers, 3 subfields, and a reading trail in 38 seconds for about $0.05. It is BYOK, Apache-2.0, and still alpha.

Limitations are real: full-PDF parsing, persistent embedding cache, Zotero/BibTeX import, and more tests are still on the backlog. I am sharing because I would like architecture feedback, especially on local graph memory and citation grounding.

# r/commandline

Title: peer: a local-first research agent that lives in the terminal

Sharing a CLI project I built called `peer`. It is for researchers who already live in terminals, plain files, Git, LaTeX, and local notes. It ships from source right now: clone the repo, run `npm install`, `npm run build`, `npm link`, then `peer doctor` and `peer onboard`.

The interesting part for this sub is the boundary. The agent is sandboxed to `~/.peer/` or `$PEER_HOME`. It has read/write/edit/grep/find/ls, but no shell/bash tool, and it cannot reach dotfiles or `~/.ssh/`. Outputs are local: SQLite for the graph, Markdown notes compatible with Obsidian, and a local D3 `graph.html`.

Commands include `peer map "<topic>"`, `peer read <arxiv-id>`, `peer ask "<question>"`, `peer cite "<claim>"`, `peer graph`, `peer history`, and `peer doctor`. Feedback on CLI shape and Unix-y failure modes would be useful.
