Tagline: Terminal-native research agent for PhDs

First comment:

Hi PH, I built peer because research work kept getting split across tabs, chats, notes, citation managers, and half-finished reading lists. peer is a terminal-native research agent for PhDs and researchers. It runs from your CLI, stores its memory locally under `~/.peer/`, and gives you commands for the research journey: `peer onboard`, `peer map`, `peer read`, `peer ask`, `peer gap`, `peer cite`, `peer relwork`, `peer graph`, and more.

It is built on `pi-agent-core`, with Claude as the planner/tool selector and 17 research tools behind it. Your notes are plain Markdown, the graph is SQLite plus embeddings, and the workflow is BYOK so costs are visible. It is also early: `v0.0.1-alpha.10`, source install only, and several important things are still backlog items. I would rather launch with those caveats than pretend it is finished. The first feedback I want is from researchers who already keep notes locally.

Questions:

1. Is this just ChatGPT for papers?

No. The difference is the loop and the state. peer plans, chooses from research tools, writes local files, updates a graph, and uses that accumulated library in later answers. It still depends on model providers, but it is not only a prompt box.

2. Why a terminal app?

Many researchers already use terminals for Git, LaTeX, scripts, notes, and reproducible work. A CLI also makes it easier to keep outputs as plain files, inspect the state, and compose the tool with an existing workflow.

3. Where does my data live?

peer stores its working state under `~/.peer/` by default, or `$PEER_HOME` if configured. That includes SQLite graph state, Markdown notes, a role-aware profile, journal entries, and a local D3 graph. Model/API providers still receive the requests needed to run the commands.

4. What does it cost?

It is BYOK, so you pay providers directly. The README estimates about $0.01 for `peer read`, `peer daily`, or `peer ask`; about $0.02 for `peer cite`; about $0.05 for `peer map`; and about $1.20 for one-time onboarding.

5. What is missing?

The README calls out the main gaps: full-PDF parsing, a persistent embedding cache, tests for newer commands, Zotero/BibTeX import, and an npm-published binary. Today it ships from source and should be treated as alpha software.
