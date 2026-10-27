# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private vulnerability reporting on this repository
(Security tab, "Report a vulnerability"), or contact the maintainer through the email on their GitHub profile.

Include what you found, the steps to reproduce it, the version or commit, and the impact you expect. You will get an
acknowledgement within a few days. Fixes land on `main` and are noted in [CHANGELOG.md](CHANGELOG.md).

## Scope

Aether runs model-written patches, generator code and scripts, and a local server that can use your own Codex or Claude Code
login. The threat model, the sandboxes (a locked-down worker pool for generators, QuickJS in WebAssembly for scripts), the
server hardening and the known limits are in [docs/SECURITY.md](docs/SECURITY.md). Reports about sandbox escapes, path
traversal, key leakage, origin or host guard bypass and proof forgery are especially welcome.

## No secrets in the repository

No API key, token or credential belongs in this repository. `.env` files are ignored; `.env.example` holds empty values.
The test fixtures contain obvious fake keys (`sk-test-...`) that exist to prove redaction. If you find a real secret in the
history, report it privately so it can be revoked and removed.
