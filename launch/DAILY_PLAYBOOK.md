# 10-day launch playbook

Baseline rules:

- Do not post the same link everywhere on the same day. Each community gets a different angle and a reason it belongs there.
- Do not post to HN during obvious clog windows: avoid 08:30-10:00 PST if `/new` is moving fast, and avoid posting right after a similar dev-tool launch is already rising. Use 07:15 PST or 10:45 PST instead.
- Do not post to r/MachineLearning on Monday morning. The front page is noisy and moderation is tighter around generic tool posts. Use Tuesday or Wednesday late morning PST.
- Do not paste Product Hunt copy into Reddit. Reddit posts should read like field notes from the builder, with limitations included.
- Before each Reddit post, spend 20 minutes leaving useful comments in that community without mentioning peer.

Day 1:

- 07:15 PST: Hacker News. Post `SHOW_HN.md`.
- 07:35-10:30 PST: Reply to every substantive HN comment. Prioritize skeptical questions: "is this just ChatGPT?", privacy, source install friction, and CLI choice.
- 10:45 PST: Twitter/X. Post `TWITTER_THREAD.md` only if the HN thread has stabilized. If HN is active, wait until 13:00 PST.
- 16:30 PST: Add a short GitHub issue label sweep and answer any repo issues opened from HN.

Day 2:

- 09:30 PST: r/commandline. Post the commandline-specific Reddit draft.
- 10:00-12:00 PST: Reply with concrete CLI details: `peer doctor`, `peer onboard`, local `~/.peer/`, sandbox, no shell/bash tool.
- 15:00 PST: Twitter/X follow-up. Post a screenshot or terminal recording around `peer doctor` and the `~/.peer/` file layout.

Day 3:

- 08:15 PST: r/PhD. Post the PhD-specific Reddit draft.
- 08:45-11:30 PST: Engage like a PhD peer, not a vendor. Ask what part of their workflow breaks first: reading order, citation recall, gap finding, or notes.
- 14:00 PST: Twitter/X. Post one hook about role-aware onboarding with a screenshot of the PhD/postdoc/faculty/industry/independent choices.

Day 4:

- 10:30 PST: Twitter/X. Post a `peer map "<topic>"` demo using the README's concrete frame: field map, subfields, cost, saved path.
- 12:30 PST: Reply to researchers who mention arXiv overload or literature maps. Do not drop links unless the reply naturally asks for the tool.
- 17:00 PST: GitHub. Triage launch feedback into issues: install friction, docs gaps, feature requests, and bugs.

Day 5:

- 09:00 PST: No new top-level community post. Use this as a trust day.
- 09:15-11:00 PST: Fix or document the top two confusing points from comments. If you cannot fix them, open transparent GitHub issues.
- 13:00 PST: Twitter/X. Post a limitation-first note: alpha status, source install, full-PDF parsing backlog, Zotero/BibTeX import backlog.

Day 6:

- 00:01 PST: Product Hunt. Launch with `PRODUCT_HUNT.md`.
- 00:05 PST: Post the maker first comment.
- 07:30-09:30 PST: Answer PH questions quickly, especially privacy, pricing, and how peer differs from Elicit/ResearchRabbit.
- 12:00 PST: Twitter/X. Share the PH link once, with one specific demo claim rather than a generic launch line.

Day 7:

- 11:30 PST: r/MachineLearning. Post the ML-specific Reddit draft. Do this only if the day is Tuesday or Wednesday; if it lands on Monday, move to Day 8 at 11:30 PST.
- 12:00-14:00 PST: Discuss architecture: `pi-agent-core`, 17 research tools, local graph, citation grounding, alpha caveats.
- 16:00 PST: Avoid bumping the thread with "thanks" replies. Add substance or stay quiet.

Day 8:

- 09:45 PST: Twitter/X. Post a sandbox/local-first hook from `HOOKS.md` with a screenshot of the safety model section or `~/.peer/` tree.
- 11:00 PST: Comment in existing threads about research tooling, note-taking, or citation management. Contribute first; link only if asked.
- 15:30 PST: GitHub. Convert repeated questions into README issues or docs tasks.

Day 9:

- 10:15 PST: Twitter/X. Post a feature-specific demo: `peer cite "<claim>"` returning BibTeX plus `\cite{...}`, or `peer relwork "<topic>"` grouping related work.
- 12:00 PST: Reply to LaTeX, Obsidian, and Zotero users with the honest state: Obsidian-compatible Markdown exists; Zotero/BibTeX import is backlog.
- 16:30 PST: Do not post in more Reddit communities. The launch will start to look like spam.

Day 10:

- 09:30 PST: Twitter/X. Post a recap: what feedback changed, what bugs were filed, what is next for v0.0.2.
- 11:00 PST: GitHub. Pin or surface the most useful issue list for newcomers: install, full-PDF parsing, Zotero/BibTeX import, persistent embedding cache.
- 14:00 PST: Final ask. Request stars, issues, and researcher feedback with the GitHub link. Keep it specific: "star if you want terminal-first research tooling to exist."
