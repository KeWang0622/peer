1. I built peer: a terminal-native research agent for PhDs and researchers. It maps fields, reads papers into your local graph, checks citations, and remembers across sessions. [hero image placeholder]

2. `peer onboard` is the starting point: tell it your role, research area, Google Scholar URL or 5 arXiv IDs. It seeds `~/.peer/` with a role-aware profile and library.

3. `peer map "diffusion alignment"` is for walking into a field cold. The README demo maps 41 papers into 3 subfields in 38s for about $0.05, then saves the trail under `~/.peer/notes/fields/`.

4. `peer read <arxiv-id>` turns a paper into a structured Obsidian-compatible Markdown note, adds graph edges, and gives future answers something local to cite.

5. `peer ask "what do I actually know about X?"` answers across your own library. It is meant to be an epistemic mirror, not a generic web answer.

6. `peer gap "X and Y"` looks for sparse intersections and concrete questions. It is aimed at the painful middle part of research: turning a vague direction into a thesis-shaped path.

7. `peer cite "claim"` returns BibTeX plus `\cite{...}`. `peer relwork "topic"` groups related work thematically instead of dumping bullets.

8. The agent is sandboxed. It can read/write/edit/grep/find/ls only inside `~/.peer/` or `$PEER_HOME`. No shell/bash tool, no access to `~/.ssh/` or dotfiles.

9. Cost is explicit because it is BYOK. README estimates: `peer read`, `daily`, and `ask` are about $0.01; `map` is about $0.05; onboarding is about $1.20.

10. peer is Apache-2.0 and alpha (`v0.0.1-alpha.10`). If terminal-first research software is your thing, star/share the repo: https://github.com/KeWang0622/peer #buildinpublic
