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
- [ ] GitHub MCP server registration
- [ ] Context selector (repo/file/PR/issue)
- [ ] Tool-exposure scoping layer

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
- `packages/api/src/mcp/MCPManager.ts` (GitHub server registration)
- `client/src/components/Chat/` (GitHub context selector)
- `api/server/controllers/agents/v1.js` (tool-exposure scoping, new layer)

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
- [ ] `packages/api/src/__tests__/mcp/github.test.ts` — GitHub MCP server registration
- [ ] Integration: attach GitHub context → grounded answer with GitHub citations

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
- [ ] GitHub MCP server appears in tool list
- [ ] "Attach GitHub context" → repo/file picker
- [ ] Attach file from repo → grounded answer cites repo + path + line range
- [ ] Attach PR/issue → answer cites PR/issue number + description snippet

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
| Phase 7 | 2 | ⏳ Pending | — |
| Phase 8 | 1 | ⏳ Pending | — |

---

**Last updated:** 2026-04-24 (Phase 0)
