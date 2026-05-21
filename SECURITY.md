# Security policy

## Reporting a vulnerability

Found something? **Don't open a public issue.** Email `ke@pika.art` directly with the subject line `peer security`. We'll respond within 48 hours.

If the issue is critical (remote code execution, secret exfiltration, data loss), we'll cut a patch release within 72 hours and credit you in the release notes (or anonymously if you prefer).

## Agent safety model

peer runs as a sandboxed agent:

- **No bash / shell tool.** The agent cannot execute arbitrary commands.
- **File operations are path-jailed** to `$PEER_HOME` (default `~/.peer/`). Any attempt to read, write, or edit a path outside this directory is refused at the operations layer (see `src/agent/sandbox.ts`).
- **API keys** (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `SEMANTIC_SCHOLAR_API_KEY`) are read from environment variables and never logged, written to disk, or sent over the network to anywhere other than the corresponding provider's official API endpoint.
- **No telemetry.** peer makes network calls only to: api.anthropic.com, api.openai.com, api.semanticscholar.org, api.openalex.org, export.arxiv.org. That's the entire egress allowlist.

## What's in scope

- Path-traversal in the sandbox
- Prompt-injection that escapes tool restrictions
- API key leakage through tool outputs, error messages, or logs
- Dependency vulnerabilities surfaced by `npm audit`
- Supply-chain risks in published builds

## What's out of scope

- Issues that require the user to manually run untrusted code
- Compromised user machines (keylogger, etc.)
- Provider-side issues at Anthropic / OpenAI

## Disclosure

We follow 90-day coordinated disclosure. If you report a CVE-class issue and we don't ship a fix in 90 days, you may go public.
