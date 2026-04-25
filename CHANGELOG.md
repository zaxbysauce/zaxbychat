# Changelog

All notable changes to zaxbychat are documented in this file. Format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [Semantic Versioning](https://semver.org/).

## [v0.9.0] — Perplexity-style migration

zaxbychat reorients around external inference endpoints, capability-aware
UI, council mode, normalized citations, retrieval donor ports, and a
first-class GitHub source provider. No bundled inference engine ships
with the container; all chat models are reached as remote endpoints.

### Added

- **Phase 1 — Unified contract & endpoint registry.** Capability namespace
  consolidation on `TModelSpec.capabilities`; registry-driven endpoint
  dispatch; pricing parity preserved across seven providers; persisted
  validation status per user.
- **Phase 2 — Capability-aware UI & pre-Run enforcement.** Client refactor
  away from enum switches; server-side pre-`Run.create()` gate rejects
  unsupported parts (vision → error, tools → drop+warn, structured
  output → prompt fallback).
- **Phase 4 — Council mode.** Up to three parallel legs per prompt, three
  synthesis strategies (`primary_critic`, `best_of_three`,
  `compare_and_synthesize`), parent/child `AbortController` hierarchy,
  per-leg stop, token-budget pre-check, per-leg leg-attribution on
  citations, full UI (toggle + strategy picker + per-agent columns +
  synthesis card). Toggleable via `interface.council`.
- **Phase 5 — Retrieval, search, citations.** Normalized `CitationSource`
  + `InlineAnchor` Zod schema; web-search and file-retrieval ingest
  helpers; per-message accumulator on `req`; remark plugin for inline
  source pills; persisted-sources panel.
- **Phase 6 — Selective ragappv3 retrieval ports.** RRF fusion, RAG prompt
  builder, document filter / dedup / window expansion (adapter-injected),
  SQL/DDL schema parser, query transformer (step-back + optional HyDE +
  optional Redis). Library-grade modules under
  `packages/api/src/retrieval/` with zero Python-only deps transplanted.
- **Phase 7 — GitHub first-class source provider.**
  - Opt-in via `kind: 'github'` on an MCP server config.
  - Per-tool citation parsers for `get_file_contents`, `search_code`,
    `list/get_pull_requests`, `list/get_issues`, `list/get_commits`,
    `search_repositories`. Mutating tools never emit citations.
  - Hard-capped tool-exposure scope layer (read-only allowlist) — a
    dedicated module separate from
    `api/server/controllers/agents/v1.js:filterAuthorizedTools`.
  - Chat-composer GitHub context picker (repo / file / PR / issue /
    commit), single-context per request, delivered to the agent as a
    deterministic terse system note. No file content prefetch.
  - Picker tool-call endpoint
    `POST /api/mcp/:serverName/tools/:toolName/call`, hard-gated on
    `kind:'github'` + allowlist + 8 KB args + 5 s timeout.
- **Phase 8 — Documentation & cleanup.** New `docs/DEPLOYMENT.md`
  control-plane-only deployment guide; council and capability examples
  added to `librechat.example.yaml`.

### Changed

- `BaseOptionsSchema.kind?: 'github'` added to MCP server config.
- `TStartupConfig.mcpServers[name].kind` mirrors the field for the
  frontend.
- `TSubmission.githubContext?` and `TPayload.githubContext?` carry the
  picker selection through to the agent run.
- `BuildMessagesInput`, `PromptBuilderConfig`, and friends are exported
  from `packages/api` for downstream consumers of the retrieval ports.

### Removed

- The temporary `GITHUB_MCP_FIRST_CLASS` env-var flag. GitHub
  first-class behavior is now controlled solely by `kind: 'github'` on
  the MCP server config — strictly opt-in, no second toggle. The
  `isGithubFirstClassEnabled` helper, the
  `TStartupConfig.githubFirstClassEnabled` mirror, the
  `useGithubFirstClassEnabled` hook, and all flag-gated code paths
  have been deleted.
- The `/home/danny/agentus` pointer in `CLAUDE.md`. The
  `@librechat/agents` package is treated as a black-box dependency
  (version pinned in `package.json`).

### Internal

- New `docs/DEPLOYMENT.md` (control-plane-only).
- Build report (`docs/zaxbychat-perplexity-build-report.md`) closed
  out for all eight phases.
- `npm run test:all` and `npm run build` clean on the merge commit.
