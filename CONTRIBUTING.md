# Contributing to peer

peer is iterating in public. PRs and issues welcome — especially from researchers across disciplines.

## Project values

- **Researcher-first.** Every change should make a real researcher's day better, not just be cool tech.
- **Local-first.** The agent works without a server. Your library is yours.
- **Honest.** Don't hide what doesn't work. Code comments and docs should age well.
- **Small, focused PRs.** Land one thing at a time.

## Setup

```bash
git clone https://github.com/KeWang0622/peer.git
cd peer
npm install
npm run build
npm link              # makes `peer` available globally
```

Then set keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) and run `peer doctor`.

## Development loop

```bash
npm run watch         # tsc --watch
npm run test          # unit tests
npm run lint          # tsc --noEmit type check
```

## What's especially welcome

- New tools/commands (`peer ___`) — propose in an issue first
- Role-specific persona tweaks for fields outside CS/ML
- Importers — Zotero, BibTeX, Notion
- Exporters — LaTeX, Markdown bundles
- Tests for the newer commands (cite, gap, compare, outline, relwork, brainstorm, collab)
- Better field-map clustering / narrative generation
- PDF parsing (currently abstract-only)
- Bug reports with reproductions and your `peer doctor` output

## What's not in scope right now

- Renaming/rebranding (we just landed peer)
- Cloud-hosted runtime (the agent stays local-first)
- A web app (the terminal IS the surface)

## Code style

- TypeScript strict mode; no `any` unless it's the SDK's type
- Files <800 lines, prefer many small files
- Immutability by default; new objects rather than mutating
- No emojis in code or commits unless explicitly UI
- Conventional commit prefixes (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, `test:`, `perf:`, `ci:`)

## Security

Found a vulnerability? Don't open a public issue — DM the maintainer or email ke@pika.art.

## License

By contributing you agree your code is licensed under Apache-2.0.
