# zaxbychat → Perplexity-style Migration — Build Report

**Status:** Phase 0 — Planning complete. Phases 1–8 to follow.  
**Started:** 2026-04-24  
**Branch:** `claude/review-swarm-plan-47MVq`

---

## Executive summary

*To be filled as phases complete.*

---

## What changed

### Phase 1 (Unified contract & endpoint registry)
- [ ] Contract types defined (EndpointRegistryEntry, ModelRegistryEntry, ModelCapabilities, Source)
- [ ] TModelSpec extended with per-model capabilities
- [ ] providerConfigMap replaced with registry lookup
- [ ] EndpointURLs made dynamic
- [ ] Pricing parity for registry entries
- [ ] Validation endpoint (internal harness)

### Phase 2 (Capability-aware UI & enforcement)
- [ ] Client selectors refactored to capability-driven
- [ ] SetKeyDialog refactored
- [ ] ContentRender capability gate
- [ ] Pre-Run.create() request validation
- [ ] Unsupported parts handling (strip/error/fallback)

### Phase 3 (External-inference hardening)
- [ ] Docker docs updated
- [ ] librechat.example.yaml cleaned
- [ ] (folded into Phase 8)

### Phase 4 (Council mode)
- [ ] councilAgents[] schema (max 3)
- [ ] Mapper flag-gated for all-legs retention
- [ ] Parent/child AbortController hierarchy
- [ ] Three synthesis strategies (primary_critic, best_of_three, compare_and_synthesize)
- [ ] Synthesis as final graph node
- [ ] Client council toggle + strategy picker + 3-model selector
- [ ] Token-budget pre-check UI
- [ ] Per-leg stop buttons

### Phase 5 (Retrieval & citations)
- [ ] Citation schema types + validators
- [ ] Web search normalized to schema
- [ ] File retrieval normalized to schema
- [ ] Citation.tsx + inline anchor rendering
- [ ] Contract test

### Phase 6 (ragappv3 donor ports)
- [x] fusion.py → `retrieval/fusion.ts` (RRF + recency blending; donor SHA c3e6c51)
- [x] prompt_builder.py → `retrieval/prompt.ts` (`[S#]` citation scheme; donor SHA 1095cb7)
- [x] document_retrieval.py → `retrieval/documents.ts` (filter + dedup + adapter-gated window; donor SHA df2301b)
- [x] schema_parser.py → `retrieval/schema.ts` (SQL DDL extraction; donor SHA abce924)
- [x] query_transformer.py → `retrieval/query.ts` (step-back + optional HyDE + optional Redis; donor SHA 848f382)

### Phase 7 (GitHub first-class)
- [x] PR 7.1 — backend: GitHub MCP first-class identity (`kind: 'github'`) + `ingestGithubResults` peer to web/file ingest + per-tool citation parsers (`get_file_contents`, `search_code`, `list_pull_requests`, `pull_request_read`, `list_issues`, `issue_read`, `get_commit`, `list_commits`, `search_repositories`) + `GITHUB_MCP_FIRST_CLASS` runtime flag + tool-end callback branch in `api/server/controllers/agents/callbacks.js` + commented `librechat.example.yaml` block.
- [x] PR 7.2 — frontend context selector (`GitHubContextButton` / `GitHubContextDialog` / `GitHubContextChip` in the chat input badge row) + dedicated GitHub MCP tool-exposure scoping layer (`applyGithubMcpScope` in `packages/api/src/mcp/github/scope.ts`, NOT reusing `v1.js:110-171`) + hard-gated picker tool-call endpoint `POST /api/mcp/:serverName/tools/:toolName/call` + `com_ui_github_*` i18n keys + agent system-note injection from `req.body.githubContext`.

### Phase 8 (Deployment & cleanup)
- [ ] Docker/deployment docs (control-plane emphasis)
- [ ] librechat.example.yaml examples (council, capabilities)
- [ ] Release notes
- [ ] CLAUDE.md updated (drop /home/danny/agentus claim)
- [ ] Feature flags removed/collapsed
- [ ] npm run build clean
- [ ] npm run test:all green

---

## Files/subsystems touched

### Phase 1
- `packages/data-provider/src/schemas.ts` (capability consolidation, registry types)
- `packages/data-provider/src/models.ts` (TModelSpec extension)
- `packages/data-provider/src/config.ts` (EndpointURLs dynamic resolver)
- `packages/data-provider/src/createPayload.ts` (dynamic URL lookup)
- `packages/api/src/endpoints/config/providers.ts` (registry-driven dispatch)
- `packages/api/src/endpoints/config/endpoints.ts` (registry config merge)
- `packages/api/src/endpoints/config/models.ts` (registry model loading)
- `packages/data-schemas/src/app/endpoints.ts` (registry parsing)
- `packages/api/src/agents/transactions.ts` (pricing parity)

### Phase 2
- `client/src/hooks/Endpoint/useEndpoints.ts` (capability-driven filtering)
- `client/src/components/Chat/Menus/Endpoints/ModelSelector.tsx` (refactor)
- `client/src/components/Chat/Menus/Endpoints/EndpointItem.tsx` (refactor)
- `client/src/components/Input/SetKeyDialog/SetKeyDialog.tsx` (capability-aware dispatch)
- `client/src/hooks/Messages/useContentMetadata.ts` (render gate)
- `client/src/components/Chat/Messages/Content/ContentRender.tsx` (capability gate)
- `packages/api/src/agents/run.ts` (pre-Run request validation)

### Phase 4
- `api/server/services/Endpoints/agents/addedConvo.js` (councilAgents schema)
- `packages/api/src/agents/client.ts` (mapper flag-gating)
- `packages/api/src/stream/GenerationJobManager.ts` (parent/child abort)
- `packages/api/src/agents/run.ts` (synthesis strategy dispatch)
- `api/server/controllers/agents/responses.js` (synthesis event handling)
- `client/src/components/Chat/` (council UI: toggle, strategy, picker)
- `client/src/hooks/Chat/useAddedResponse.ts` (enhanced for 3-model picker)
- `client/src/components/Chat/Messages/Content/ParallelContent.tsx` (synthesis card)

### Phase 5
- `packages/data-provider/src/types.ts` (Source + InlineAnchor types)
- `packages/api/src/web/web.ts` (source normalization)
- `packages/api/src/files/context.ts` (source normalization)
- `client/src/components/Web/Citation.tsx` (schema-driven rendering)
- `client/src/utils/citations.ts` (existing Unicode anchor logic)

### Phase 6
- `packages/api/src/retrieval/types.ts` (shared `RagSource` / `RetrievalRecord` / `VectorStoreAdapter` / `MemoryRecord` types)
- `packages/api/src/retrieval/fusion.ts` (RRF + recency blending)
- `packages/api/src/retrieval/prompt.ts` (`[S#]` label scheme + structured user content; independent of Phase 5 `[n]` path)
- `packages/api/src/retrieval/documents.ts` (filter + dedup + adapter-gated window expansion)
- `packages/api/src/retrieval/schema.ts` (SQL DDL extraction)
- `packages/api/src/retrieval/query.ts` (step-back + optional HyDE + optional Redis; injected `ChatCompletionFn`)
- `packages/api/src/retrieval/index.ts` (barrel)
- `packages/api/src/index.ts` (re-exports `./retrieval`)

### Phase 7

**PR 7.1 (landed)**
- `packages/data-provider/src/mcp.ts` — `BaseOptionsSchema` gains optional `kind: z.literal('github').optional()` marker. Identity is strictly opt-in.
- `packages/data-provider/src/citations/normalize.ts` — adds `RawGithubResult`, `toGithubCitationSource`, `normalizeGithubResults`. Required `repo`; failure on missing repo / inverted line ranges; honest title derivation.
- `packages/api/src/mcp/github/flag.ts` — `isGithubFirstClassEnabled` reads `GITHUB_MCP_FIRST_CLASS` (default-off; cached per process).
- `packages/api/src/mcp/github/identity.ts` — `isGithubMcpServer`, `parseGithubMcpToolKey`, `isGithubMcpToolKey` helpers. No URL/hostname heuristics.
- `packages/api/src/mcp/github/parsers.ts` — per-tool parser registry mapping MCP payloads to `RawGithubResult[]`. Mutating tools and unknown tool names route to `[]`. Parser throws are swallowed.
- `packages/api/src/mcp/github/index.ts` — barrel.
- `packages/api/src/citations/persist.ts` — adds `ingestGithubResults` peer to `ingestWebResults` / `ingestFileResults`. Hard-gated on flag + allowlisted tool name.
- `packages/api/src/index.ts` — re-exports `./mcp/github` next to existing MCP exports.
- `api/server/controllers/agents/callbacks.js` — adds `extractMcpJsonPayload` helper + GitHub MCP branch in `createToolEndCallback`, ahead of the artifact early-exit. Reuses Phase 5's `_citationBuffer` accumulator.
- `librechat.example.yaml` — commented `mcpServers.github` example showing the `kind: 'github'` marker + PAT header.

**PR 7.2 (landed)**
- `packages/data-provider/src/types/github.ts` — `GithubContextSelection` + Zod schema (single-context per request; honest-shape refinements).
- `packages/data-provider/src/config.ts` — `TStartupConfig.githubFirstClassEnabled` mirror + `mcpServers.kind` mirror.
- `packages/data-provider/src/types.ts` + `createPayload.ts` — `TSubmission.githubContext` + `TPayload.githubContext` threaded through; spread into payload only when a selection is attached.
- `packages/data-provider/src/api-endpoints.ts` + `data-service.ts` — `mcpToolCall(serverName, toolName)` endpoint helper + `callMcpPickerTool` data-service.
- `packages/api/src/mcp/github/scope.ts` — `GITHUB_MCP_PICKER_ALLOWLIST` (citation-emitting set + `list_branches`); pure `applyGithubMcpScope` filter; `shouldDropForGithubScope` predicate. Separate from `v1.js:110-171`.
- `packages/api/src/mcp/github/picker.ts` — `validatePickerToolRequest` pure function enforcing the four hard gates (404 flag-off, 401 unauth, 403 non-allowlisted tool, 404 non-`kind:'github'` config, 400/413 malformed args).
- `packages/api/src/mcp/github/context.ts` — `renderGithubContextSystemNote` deterministic, terse instruction string.
- `packages/api/src/types/http.ts` — `RequestBody.githubContext?: GithubContextSelection` extension.
- `packages/api/src/agents/initialize.ts` — runs `applyGithubMcpScope` on the final `tools` list and appends the rendered system note to `agent.additional_instructions` when `req.body.githubContext` validates.
- `api/server/controllers/mcp.js` — new `callPickerTool` controller (thin glue over `validatePickerToolRequest` + `MCPManager.callTool` with 5s `AbortController`).
- `api/server/routes/mcp.js` — `POST /api/mcp/:serverName/tools/:toolName/call` route gated by `requireJwtAuth`.
- `api/server/routes/config.js` — populates `githubFirstClassEnabled` on the startup-config payload.
- `client/src/store/githubContext.ts` — Recoil atom for the current selection.
- `client/src/hooks/MCP/useGithubFirstClass.ts` — `useGithubFirstClassEnabled` + `useGithubMcpServers` hooks.
- `client/src/data-provider/MCP/useCallPickerTool.ts` — React-Query mutation for the picker call.
- `client/src/components/Chat/Input/GitHubContext/` — `GitHubContextButton`, `GitHubContextDialog`, `GitHubContextChip`, barrel `index.ts`.
- `client/src/components/Chat/Input/BadgeRow.tsx` — renders `<GitHubContextButton />` next to `<MCPSelect />`.
- `client/src/hooks/Chat/useChatFunctions.ts` — reads atom and threads `githubContext` onto the submission; resets atom after dispatch.
- `client/src/locales/en/translation.json` — `com_ui_github_*` keys (~22 strings).

### Phase 8
- `docs/` (deployment docs)
- `librechat.example.yaml` (examples)
- `CLAUDE.md` (drop agentus claim)
- `Dockerfile`, `docker-compose.yml`, `deploy-compose.yml` (docs only, no runtime changes)

---

## Donor logic ported from ragappv3

### Phase 6 ports (from zaxbysauce/ragappv3 @ 653d963e)

| Donor module | Donor SHA | Donor lines | TS module | Python-only deps replaced |
|--------------|-----------|-------------|-----------|---------------------------|
| `backend/app/utils/fusion.py` | c3e6c51 | 1-86 | `retrieval/fusion.ts` | None (pure algorithm) |
| `backend/app/services/prompt_builder.py` | 1095cb7 | 1-211 | `retrieval/prompt.ts` | `settings.*` globals → injected `PromptBuilderConfig`; `MemoryRecord` → port-local shape |
| `backend/app/services/document_retrieval.py` | df2301b | 1-420 | `retrieval/documents.ts` | `settings.*` globals → injected `DocumentRetrievalConfig`; `vector_store.get_chunks_by_uid` → optional `VectorStoreAdapter` (no-op without adapter) |
| `backend/app/services/schema_parser.py` | abce924 | 1-130 | `retrieval/schema.ts` | `pathlib.Path` → `node:fs/promises` |
| `backend/app/services/query_transformer.py` | 848f382 | 1-252 | `retrieval/query.ts` | `settings.*` globals → injected `QueryTransformerConfig`; `LLMClient.chat_completion` → injected `ChatCompletionFn`; `redis` (Python client) → optional `RedisLike` interface; `hashlib.md5` → `node:crypto`; `OrderedDict` LRU → `Map` with size-cap cycling |

**Port constraints satisfied (D-P6 locks):**
- D-P6-1 — port-only; zero call-site integration in `/api` or existing `/packages/api`.
- D-P6-2 — `expandWindow` requires the optional `VectorStoreAdapter`; returns input unchanged when absent.
- D-P6-3 — Phase 5 `[n]` marker path (`CITATION_MARKER_INSTRUCTION` in `agents/run.ts`) untouched; `[S#]` lives only in the new `retrieval/prompt.ts`.
- D-P6-4 — `QueryTransformer` takes `ChatCompletionFn` at construction; no coupling to `@librechat/agents` or any provider client.
- D-P6-5 — fixtures synthesized inline per spec (donor inputs are deterministic data; running ragappv3 not required).
- D-P6-6 — `MemoryRecord` is a port-local shape in `retrieval/types.ts`; no coupling to `packages/api/src/memory/`.

### Rejected donor modules (per Phase 6 scope)

- `rag_engine.py`: Orchestration layer; rewrite in zaxbychat.
- `document_processor.py`: Tangled dependencies (unstructured, pandas, sqlite, VectorStore).
- `vector_store.py`: LanceDB-specific; no TS client.
- `embeddings.py`: Local mode uses torch; HTTP mode OK but Phase 6 focused on retrieval quality, not embeddings.
- `reranking.py`: Same as embeddings.

---

## Tests added/updated

### Phase 1
- [ ] `packages/data-provider/src/__tests__/schemas.test.ts` — EndpointRegistryEntry, ModelRegistryEntry, ModelCapabilities types
- [ ] `packages/api/src/__tests__/endpoints/registry.test.ts` — registry lookup preserving 7 providers byte-identical
- [ ] `packages/api/src/__tests__/endpoints/pricing.test.ts` — getMultiplier parity for registry entries
- [ ] Snapshot tests for OpenAI, Google, Anthropic, Azure, Bedrock, Assistants, Agents payloads

### Phase 2
- [ ] `client/src/__tests__/hooks/useEndpoints.test.ts` — capability-driven filtering
- [ ] `client/src/__tests__/components/ModelSelector.test.ts` — refactored selector logic
- [ ] `packages/api/src/__tests__/agents/validation.test.ts` — pre-Run request gates

### Phase 4
- [ ] `packages/api/src/__tests__/agents/council.test.ts` — councilAgents max 3, mapper flag-gating, per-leg abort
- [ ] `packages/api/src/__tests__/agents/synthesis.test.ts` — three strategies, templated prompts, prompt injection prevention
- [ ] `api/server/routes/__tests__/agents/council.test.ts` — 1/2/3-model flows, stop-all/stop-one, resume-before/during-synthesis
- [ ] Pricing parity: council (3 agents + synthesis ≈ 4 txns per query)

### Phase 5
- [ ] `packages/data-provider/src/__tests__/citations.test.ts` — Source + InlineAnchor contracts
- [ ] `packages/api/src/__tests__/web/citations.test.ts` — web search → normalized schema
- [ ] `packages/api/src/__tests__/files/citations.test.ts` — file retrieval → normalized schema
- [ ] Contract test: JSON shape locked

### Phase 6
- [x] `packages/api/src/retrieval/__tests__/fusion.test.ts` — RRF formula, dedup, recency-blend neutral default, per-list weights, limit, stable sort
- [x] `packages/api/src/retrieval/__tests__/prompt.test.ts` — `calculate_primary_count` formula, `[S#]` header, `[[MATCH: …]]` parent-window markers, anchor-best-chunk token gate, history truncation, memory block
- [x] `packages/api/src/retrieval/__tests__/documents.test.ts` — reupload-hash detection, multi-scale dedup, group-aware dedup caps, `_distance` gating, reranker override, `indexedFileIds` filter, `noMatch` flag, adapter-injected window expansion + two-tier ordering, no-adapter no-op
- [x] `packages/api/src/retrieval/__tests__/schema.test.ts` — VIRTUAL/IF NOT EXISTS/schema-prefix/quoted identifiers, multi-block extraction, case-insensitive, multi-line column blocks, file-not-found, 50MB cap, invalid extension rejection
- [x] `packages/api/src/retrieval/__tests__/query.test.ts` — exact/document skip heuristic, cache hit/miss, LRU re-entry, LLM error fallback, HyDE length gate, optional Redis read/write with TTL
- Summary: 69 tests across 5 suites, all passing (`cd packages/api && npx jest retrieval`).

### Phase 7

**PR 7.1 (landed)**
- [x] `packages/data-provider/src/__tests__/citations.normalize.test.ts` — `toGithubCitationSource` ok/failure paths (missing repo, inverted line range, title derivation, leg attribution); `normalizeGithubResults` batch order + per-index failure reporting.
- [x] `packages/api/src/mcp/github/__tests__/flag.test.ts` — `GITHUB_MCP_FIRST_CLASS` truthiness rules; cache reset.
- [x] `packages/api/src/mcp/github/__tests__/identity.test.ts` — `isGithubMcpServer` is true only for explicit `kind: 'github'` (no URL heuristics); `parseGithubMcpToolKey` handles tool names with underscores; `isGithubMcpToolKey` resolves via injected resolver.
- [x] `packages/api/src/mcp/github/__tests__/parsers.test.ts` — per-tool parsers (file/code/issue/pr/commit/repo) produce schema-valid sources; mutating tools and unknown names yield `[]`; parser throws yield `[]`; honest-shape on missing repo/path/number.
- [x] `packages/api/src/citations/__tests__/persist.github.test.ts` — flag-off no-op; non-allowlisted no-op; appends after existing sources without renumbering; threads `legAttribution`; preserves identity across repeat ingests; multi-citation `search_code` ingestion.
- Summary: 37 new tests across 5 suites (data-provider 6 + packages/api 31), all green via `cd packages/data-provider && npx jest citations.normalize` and `cd packages/api && npx jest --testPathPatterns "(github|citations)"`.

**PR 7.2 (landed)**
- [x] `packages/api/src/mcp/github/__tests__/scope.test.ts` — allowlist members; flag-off no-op; non-MCP tools untouched; generic MCP servers untouched; `kind:'github'` server with allowlisted tool kept; `kind:'github'` server with mutating / unknown tool dropped; resolver returning undefined defensive case; `applyGithubMcpScope` order preservation + non-mutation.
- [x] `packages/api/src/mcp/github/__tests__/picker.test.ts` — every gate exercised (404 flag-off, 401 unauth, 400 missing names, 403 non-allowlisted, 400 non-object args, 413 oversized args, 404 non-`kind:'github'` config, 404 missing config); happy-path returns `{ ok: true, serverConfig }` for each allowlisted tool.
- [x] `packages/api/src/mcp/github/__tests__/context.test.ts` — empty selection → empty string; minimal repo-only note; ref + path + line ranges; single line; pr/issue/commit `item=type#id`; determinism.
- [x] `packages/data-provider/src/__tests__/citations.normalize.test.ts` — extended for PR 7.1 normalizer; PR 7.2 reuses unchanged (same contract).
- [x] `client/src/components/Chat/Input/__tests__/GitHubContextButton.spec.tsx` — flag-off and zero-server gates render nothing; modal opens on click; valid selection renders the chip; chip remove clears the recoil atom (frontend jest runs in CI; sandbox lacks `jest-environment-jsdom`).
- Summary: PR 7.2 adds 41 backend tests across 3 new suites (`packages/api && npx jest --testPathPatterns "(scope|picker|context)"`) plus a frontend spec (CI-only). Combined Phase 7 backend test count: **130 across 11 suites, all green** (`cd packages/api && npx jest --testPathPatterns "(github|citations)"`).

### Phase 8
- [ ] `npm run e2e:ci` updated: add 3-model council smoke

---

## Commands run (per phase)

### Phase 1
```bash
npm run lint
npm run test:packages:data-provider
npm run test:packages:data-schemas
npm run test:packages:api
npm run build
```

### Phase 2
```bash
npm run lint
npm run test:client
npm run test:api
npm run build
```

### Phase 4
```bash
npm run lint
npm run test:api
npm run test:packages:api
npm run build
npm run e2e:ci (with 3-model smoke added)
```

### Phase 5–8
Similar per-phase lint, test, build gates (listed in migration-notes.md).

---

## Manual validation completed

### Phase 1
- [ ] Add custom endpoint via YAML → visible in endpoint selector
- [ ] Validate endpoint (button) → status updates
- [ ] Select model from endpoint → renders with declared capabilities
- [ ] Old librechat.yaml unchanged → boots identical

### Phase 2
- [ ] Select model without vision → vision toggle disabled
- [ ] Select model with tools → tools enabled
- [ ] Select model with structured output → structured mode available
- [ ] Capability enforcement: send vision to non-vision model → error or fallback

### Phase 4
- [ ] Toggle council mode ON → adds second endpoint selector
- [ ] Choose 2 models + strategy → submit runs both in parallel
- [ ] Choose 3 models + "best_of_three" → individual outputs + synthesis card
- [ ] Stop one model → other continues; stop primary → synthesis canceled
- [ ] Disconnect mid-council → reconnect shows all partial outputs + synthesis in progress
- [ ] Token budget pre-check shows 4× estimate for 3 agents + synthesis
- [ ] Pricing: transaction count is (3 agents + synthesis inputs + synthesis generation) ≈ 5 txns

### Phase 5
- [ ] Web search answer shows clickable sources with inline [S1] anchors
- [ ] Hover source → snippet + domain + publish date
- [ ] File attachment → file citation in answer with page numbers
- [ ] Council mode: synthesis cites which leg discovered each source

### Phase 7

**PR 7.1 (landed) — backend ingest only, no UI yet:**
- [x] `kind: 'github'` MCP server config validates against `MCPOptionsSchema`.
- [x] With `GITHUB_MCP_FIRST_CLASS=true` and a `kind: 'github'` server in `librechat.yaml`, allowlisted GitHub MCP tool calls populate `_citationBuffer` with `kindSpecific.kind: 'github'` sources.
- [x] Mutating tools (`create_*`, `update_*`, `add_*`, `merge_*`, etc.) emit no citations (verified by parser unit tests).
- [x] Identity is strictly opt-in — no URL/hostname heuristics; absence of `kind` keeps the server generic.

**PR 7.2 (landed):**
- [x] GitHub context selector UI: badge-row button (`GitHubContextButton`) + modal picker (`GitHubContextDialog`) + selected-context chip (`GitHubContextChip`).
- [x] Selector hides itself when no `kind:'github'` server is configured or `githubFirstClassEnabled` is false (mirrored from startup config).
- [x] Single-context per request enforced by `githubContextSelectionSchema`; honest-shape (omits fields that can't be represented honestly).
- [x] Tool-exposure scoping layer (`applyGithubMcpScope`) enforces the hard-cap allowlist as a separate, dedicated module — does not reuse `v1.js:110-171`.
- [x] Picker's tool-call endpoint (`POST /api/mcp/:serverName/tools/:toolName/call`) is GitHub-only by enforcement (404 for non-`kind:'github'` configs); generic path for routing only.
- [x] System note injection uses the user's `githubContext` to instruct the agent to consult the scoped GitHub MCP tools — no file pre-fetch, citations come from the agent's own tool calls (PR 7.1 ingest path).

### Phase 8
- [ ] Feature flags OFF → council mode, capability enforcement, new citations hidden
- [ ] Feature flags ON → all features visible
- [ ] After final ship, all flags removed → code is clean

---

## Known remaining gaps

*To be filled as phases complete.*

---

## Phase sign-offs

| Phase | PR count | Status | Date |
|-------|----------|--------|------|
| Phase 0 | 0 | ✅ Complete | 2026-04-24 |
| Phase 1 | 4 | ⏳ Pending | — |
| Phase 2 | 2 | ⏳ Pending | — |
| Phase 3 | 0 | ⏳ Folded into Phase 8 | — |
| Phase 4 | 3 | ⏳ Pending | — |
| Phase 5 | 2 | ⏳ Pending | — |
| Phase 6 | 1 | ⏳ Pending | — |
| Phase 7 | 2 | ✅ Both PRs landed | — |
| Phase 8 | 1 | ⏳ Pending | — |

---

**Last updated:** 2026-04-24 (Phase 0)
