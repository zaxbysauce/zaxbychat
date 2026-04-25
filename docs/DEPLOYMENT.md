# Deployment

zaxbychat is a **control-plane-only** application. The bundled stack
runs the LibreChat server, MongoDB, MeiliSearch, the optional RAG API
service, and a vector store — but **no inference engine ships with the
container**. All chat models are reached as remote API endpoints
configured via `librechat.yaml`.

This document covers what bundled services exist, where to register
external inference endpoints, and the small set of feature surfaces
introduced by the Perplexity-style migration (Phases 1–8).

---

## What ships in the container

| Service | Purpose | Required |
|---|---|---|
| **api** | LibreChat Express server (this repository) | Yes |
| **mongodb** | Conversation, message, agent, MCP server, ACL storage | Yes |
| **meilisearch** | Full-text search index over messages | Optional |
| **rag_api** | Document retrieval HTTP service used by the file-search tool | Optional |
| **vectordb** | pgvector-backed store fronting `rag_api` | Optional, paired with `rag_api` |

No bundled inference: there is no Ollama, llama.cpp, vLLM, or
text-generation-webui in the default `docker-compose.yml`. To add a
local inference engine, register it as a custom endpoint in
`librechat.yaml.endpoints.custom`; deployment of that engine is out of
scope for this stack.

---

## External inference endpoint registration

Every chat model used by zaxbychat is reached over the network. Add
endpoints under `endpoints` in `librechat.yaml`. See `librechat.example.yaml`
for the full schema; the typical shape is:

```yaml
endpoints:
  custom:
    - name: 'My OpenAI-compatible endpoint'
      apiKey: '${OPENAI_API_KEY}'
      baseURL: 'https://your-host/v1'
      models:
        default: ['gpt-4o-mini']
        fetch: false
```

Endpoint capabilities (vision, tools, structured output, etc.) are
declared per-`modelSpec` rather than per-endpoint — the
capability-aware UI surfaces only the affordances each model actually
supports, and the server-side pre-Run gate refuses unsupported parts.

---

## Feature surfaces

The Perplexity-style migration added five user-facing surfaces. None
of them is gated by a temporary env-var flag — each is a documented
permanent feature controlled either by `librechat.yaml` configuration
or by per-spec / per-server markers.

### Capability-aware UI and pre-Run enforcement (Phase 1–2)

- **Where to configure:** per-`modelSpec.capabilities` in `librechat.yaml`.
- **What it does:** the UI hides toggles a model does not declare; the
  server refuses requests containing parts a model cannot handle (e.g.
  vision attachments to a text-only model).

### Council mode (Phase 4)

- **Where to enable:** `interface.council: true` in `librechat.yaml`.
- **What it does:** lets a user fan a single prompt out to up to three
  models, each running as a parallel "leg", and view a synthesized
  answer. Per-leg abort, per-leg stop, and per-leg leg-attribution on
  citations are all supported.

### Normalized citations (Phase 1 + Phase 5)

- **Where to enable:** always-on for any tool that emits sources via
  the contract (`web_search`, `file_search`, GitHub MCP).
- **What it does:** every persisted assistant message carries a
  `sources[]` array conforming to the `CitationSource` Zod schema, and
  inline `[n]` markers are parsed into honest `inlineAnchors`.
  Out-of-range markers are silently dropped (never fabricated).

### Selective ragappv3 retrieval ports (Phase 6)

- **Where to use:** `packages/api/src/retrieval/` — RRF fusion, prompt
  builder, document filter/dedup, SQL/DDL schema parser, query
  transformer (step-back + optional HyDE). Library-grade; consumed by
  follow-on integrations.

### GitHub first-class source provider (Phase 7)

- **Where to enable:** add an MCP server entry with `kind: 'github'` to
  `librechat.yaml.mcpServers`. See the GitHub example in
  `librechat.example.yaml`.
- **What it does:**
  - Tool results from `get_file_contents`, `search_code`,
    `list/get_pull_requests`, `list/get_issues`, `list/get_commits`,
    and `search_repositories` are normalized into citations with
    `kindSpecific.kind: 'github'`.
  - The agent's exposed GitHub MCP tools are hard-capped to the
    read-only allowlist; mutating tools are stripped from the agent
    surface even if exposed by the server.
  - The chat composer surfaces a "GitHub Context" picker
    (repo / file / PR / issue / commit). The selection rides the chat
    request and is delivered to the agent as a terse system note;
    no file contents are pre-fetched.

---

## Environment variables

zaxbychat does not introduce any new feature-toggle env vars in the
shipped release. The standard LibreChat env vars (`MONGO_URI`,
`OPENAI_API_KEY`, etc.) are documented in `.env.example`.

---

## Verifying a deployment

```bash
npm run build      # compile all packages
npm run test:all   # multi-workspace jest
npm run e2e:ci     # Playwright smoke (CI config)
```

The `test:all` target runs the data-provider, data-schemas, packages/api,
api, and client jest suites in sequence. CI gates a deployment-ready
branch on all three commands returning zero.
