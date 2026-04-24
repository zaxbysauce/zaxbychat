# zaxbychat → Perplexity-style External-Inference Migration

**Status:** Phase 0 — Planning artifact approved. Ready for Phase 1.
**Date:** 2026-04-24
**Branch:** `claude/review-swarm-plan-47MVq`
**Prepared by:** Swarm investigation agents + independent critic review

---

## 0. Purpose & scope

This document is the authoritative binding artifact for the migration of zaxbychat (LibreChat fork at `/home/user/zaxbychat`) into a Perplexity-style research application with:
- **External inference endpoints** (user-registerable, per-model capability flags)
- **Council mode** (bounded to 3 models per query, with deterministic synthesis)
- **Grounded retrieval** (web, files, GitHub sources with stable citation model)
- **GitHub-first research workflows** (via MCP integration and source grounding)
- **Control-plane-only deployment** (no bundled inference runtimes)

This is **not** a prototype, design exercise, or thin UI refresh. The artifact locks the contract shapes and phase sequence. Each phase is dependency-ordered and produces working, tested, mergeable code.

---

## 1. Policy overrides

**CLAUDE.md exceptions approved by user:**
- Creation of `/home/user/zaxbychat/docs/` directory and two `.md` files (migration-notes, build-report) — normally prohibited by CLAUDE.md's "NEVER proactively create documentation files" rule.
- **@librechat/agents source path claim in CLAUDE.md is invalid:** `/home/danny/agentus` does not exist. Future sessions should read this artifact first. CLAUDE.md will be updated in Phase 8 to remove the claim.

---

## 2. Locked decisions (from user answers Q1–Q10)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Docs creation** | Authorized | Planning artifact + running report required for binding phase sequence |
| **Council billing** | Per-leg + synthesis | Transparent token accounting; pre-check budget warning in UI |
| **@librechat/agents version pin** | Exact `3.1.68` (locked at migration start) | Prevent upstream API churn; upgrades are explicit phase-boundary decisions only |
| **Feature flags** | Each major surface behind own env-var flag, default-off | Council mode, capability enforcement, normalized citations, GitHub first-class each independently toggleable; collapsed before final ship |
| **Endpoint selector** | Multi-select-capable hook, early (Phase 2) | Single implementation path; Phase 4 reuses via hook composition, not parallel component |
| **Synthesis resume protocol** | Final graph node (preferred) | Cleaner SSE event ordering; post-graph server step is escape hatch if direct implementation fails |
| **Citation provenance** | Predeclared in Phase 1 contract | Per-agent attribution shape locked before Phase 4; Phase 5 implements to contract |
| **Capability namespace** | Consolidate toward `TModelSpec` | Single per-model surface (packages/data-provider/src/models.ts:11–40); existing endpoint-level `Capabilities`/`AgentCapabilities` enums remain (distinct scope) |
| **Project scope** | Phased multi-PR delivery | Dependency-ordered work; completeness > speed; no time pressure as planning input |
| **Cross-cutting gates** | Billing/pricing parity, i18n, rollback strategy mandatory | Every phase gate includes these; not optional |

---

## 3. Verified reference map

All file:line citations verified via `grep` against `/home/user/zaxbychat` branch `claude/review-swarm-plan-47MVq`.

### Provider architecture

| Entity | Location | Evidence |
|--------|----------|----------|
| Provider enums | `packages/data-provider/src/schemas.ts:18–28` (EModelEndpoint), `:31–44` (Providers), `:96–109` (BedrockProviders) | 2,058 refs repo-wide, 277 in packages/api/src, 641 in client/src |
| Custom endpoint prior art | `:26` (EModelEndpoint.custom enum value); `packages/api/src/endpoints/custom/config.ts:10–56` (loader); `librechat.example.yaml:336–393` (YAML shape) | Fully implemented, supports baseURL, auth, headers, addParams, dropParams, titleConvo, modelDisplayLabel, streamRate |
| Hardcoded provider dispatch | `packages/api/src/endpoints/config/providers.ts:32` (providerConfigMap dict); lookup at `:72–78` | 7 hardcoded entries; must become registry-driven |
| Endpoint URL dispatch | `packages/data-provider/src/config.ts` (EndpointURLs const); resolver at `packages/data-provider/src/createPayload.ts:25–29` | Must become dynamic without breaking `/api/agents/chat/:endpoint` route shape |
| Capability namespaces (overlapping) | `Capabilities` enum @ `config.ts:208–214`; `AgentCapabilities` @ `:216–230`; `interfaceSchema` toggles @ `:724,737,769,784`; `TModelSpec` @ `packages/data-provider/src/models.ts:11–40` | **DRY risk:** four overlapping capability surfaces; consolidate toward TModelSpec |

### Council mode infrastructure

| Entity | Location | Evidence |
|--------|----------|----------|
| Added-convo schema | `packages/data-schemas/src/schema/message.ts:150–152` | `addedConvo: boolean` field on message |
| Server plumbing | `api/server/services/Endpoints/agents/addedConvo.js:45–142` | `processAddedConvo()` validates and initializes second agent; `agentConfigs.set()` at :126 |
| Multi-agent mapper | `packages/api/src/agents/client.ts:314,322,386` | `createMultiAgentMapper()` filters each group to primary; strips metadata before client |
| Client hook | `client/src/hooks/Chat/useAddedResponse.ts:18` | `ADDED_INDEX = 1`; manages second conversation |
| Parallel content render | `client/src/components/Chat/Messages/Content/ParallelContent.tsx` | Renders by `groupId` |
| Render gate | `client/src/hooks/Messages/useContentMetadata.ts` + `ContentRender.tsx:151` | `hasParallelContent` detection, conditional layout |

### SSE and streaming

| Entity | Location | Evidence |
|--------|----------|----------|
| SSE controller | `api/server/controllers/agents/request.js:39` (ResumableAgentController) | Orchestrates request → job → streaming |
| Event catalog | `api/server/controllers/agents/responses.js:79–87` | `response.in_progress`, `.output_item.added`, `.content_part.added`, `.output_text.delta`, `.done`, `.function_call_arguments.delta`, `.completed`, `[DONE]` |
| Resume state anchors | `GenerationJobManager.ts:851–886` (pendingEvents construction); `:1096–1105` (runSteps retrieval) | In-memory: drained buffer events returned as `pendingEvents` since sync; Redis mode: persisted via appendChunk |
| Abort plumbing | `:221,425` (AbortController instantiation per-runtime); `:613` (abort call) | Shared controller; per-leg abort requires new parent/child hierarchy |

### Run dispatch and @librechat/agents

| Entity | Location | Evidence |
|--------|----------|----------|
| Import declaration | `packages/api/src/agents/run.ts:2` | `import { Run, Providers, Constants } from '@librechat/agents'` |
| Provider mapping | `run.ts:512–514` | Resolved provider string → Providers enum |
| LLM config assembly | `run.ts:527–534` | Combines provider, model, streaming, agent parameters |
| Graph creation | `run.ts:626–645` | `Run.create()` invocation; @librechat/agents owns graph execution |
| Source availability | `/home/danny/agentus` | **ABSENT** — package is black-box; version pinned at 3.1.68 |

### Billing and transactions

| Entity | Location | Evidence |
|--------|----------|----------|
| Token multiplier | `packages/api/src/agents/transactions.ts:96–123` | `getMultiplier({model, endpointTokenConfig, inputTokenCount, ...})` call; used in spend calculations at lines 98, 120 |
| EndpointTokenConfig coupling | `:12, :19, :23, :33, :84` | Pricing keyed on endpoint + model; council fan-out multiplies spend by ~4× (3 legs + synthesis) |

### Web and files

| Entity | Location | Evidence |
|--------|----------|----------|
| Web search | `packages/api/src/web/web.ts:92–252` | Auth loading; no normalized citation schema today; results embedded in tool outputs |
| Files context | `packages/api/src/files/context.ts:16–65` | Token-limited text injection; retrieval at query time |
| RAG externalized | `packages/api/src/files/rag.ts:26,38` | RAG API at `process.env.RAG_API_URL`; embeddings external |

### MCP

| Entity | Location | Evidence |
|--------|----------|----------|
| Manager | `packages/api/src/mcp/MCPManager.ts:27–150` | Server registry; discovery; user-configurable connections |
| Tool authorization | `api/server/controllers/agents/v1.js:110–171` | Per-agent tool-allowlist filter; **not** a general MCP auth layer (do not reuse for council-scoping) |

### Deployment

| Surface | Status | Files |
|---------|--------|-------|
| Active services | Control-plane only | `docker-compose.yml`, `deploy-compose.yml`: Mongo, MeiliSearch, pgvector, RAG API (lite), NGINX |
| Optional inference examples | Not deployed | `docker-compose.override.yml.example:112–143` (Ollama, LiteLLM — commented out) |
| Example config | External inference only | `librechat.example.yaml:336–393` (custom endpoints); no bundled model catalogs |

---

## 4. Risk catalog

| Risk | Impact | Mitigation | Phase |
|------|--------|-----------|-------|
| **R1. @librechat/agents black-box** | Capability enforcement must happen pre-`Run.create()` in zaxbychat, or via fork | Version pin; compatibility shim test; fork trigger policy | 1, 3 |
| **R2. Mapper filters to primary only** | Council "show all legs" requires non-trivial mapper + storage changes | Flag-gated mapper refactor; retain all legs with groupId | 4 |
| **R3. Abort is all-or-nothing** | Per-leg stop buttons require new parent/child AbortController hierarchy | New controller construction at GenerationJobManager.ts:221,425 sites | 4 |
| **R4. Synthesis resume protocol** | Two possible approaches (graph-node vs. post-graph step) — choose before coding | Design doc locks choice in Phase 1; escape hatch available if needed | 4 |
| **R5. No citation schema today** | Citations embedded in tool outputs; council synthesis must reference sources clearly | Predeclare schema in Phase 1 contract; implement in Phase 5 | 1, 4, 5 |
| **R6. Token-budget multiplier** | Council (3 agents + synthesis ≈ 4×) can silently over-charge users | Per-leg billing; pricing-parity test; pre-check UI budget warning | 1, 4 |
| **R7. Hardcoded dispatch tables** | `providerConfigMap` and `EndpointURLs` must become registry-driven without breaking routes or snapshot tests | Registry lookup preserving route shape; byte-identical snapshot tests | 1 |
| **R8. Capability-namespace DRY violation** | Four overlapping surfaces (Capabilities, AgentCapabilities, interfaceSchema, TModelSpec) | Consolidate on TModelSpec; explicit bridges for endpoint-level flags | 1 |
| **R9. Transactions/pricing coupling** | Endpoint registry changes must preserve `getMultiplier(endpointTokenConfig, ...)` semantics | Pricing-parity test in Phase 1 PR 1.3; council council pricing in Phase 4 | 1, 4 |
| **R10. i18n omission** | New user-facing strings ship English-only | Acceptance gate: every new string routes through `useLocalize()`; update `en/translation.json` | All phases |
| **R11. No rollback safety** | Buggy phase blocks all users | Feature-flag each surface; rollback is env-var flip + app restart | All phases |

---

## 5. Unified contracts (binding pre-implementation specification)

These shapes are **not tentative.** They are the contract that all phases implement against. Changes require documented exceptions.

### 5.1 Endpoint registry contract

```typescript
// packages/data-provider/src/schemas.ts (Phase 1 PR 1.1 / 1.2)
// Extends existing librechat.yaml custom-endpoint pattern

type EndpointRegistryEntry = {
  id: string;                    // stable UUID or slug
  name: string;                  // display name
  compatibilityType: 
    | 'openai' 
    | 'google' 
    | 'anthropic' 
    | 'azure_openai' 
    | 'bedrock' 
    | 'generic_openai_compatible';
  providerKind: string;          // 'openai', 'zai', 'ollama', 'lmstudio', 'vllm', 'sglang', 'custom'
  baseUrl: string;
  authType: 'api_key' | 'bearer' | 'none' | 'oauth' | 'custom_header';
  authConfig: {
    keyRef?: string;             // env var name or user-key reference
    headerName?: string;
    headers?: Record<string, string>;
  };
  enabled: boolean;
  tags: string[];                // e.g., ['reasoning', 'vision-capable', 'custom']
  lastValidatedAt?: string;      // ISO8601
  validationStatus: 'unknown' | 'ok' | 'failed' | 'stale';
  headers?: Record<string, string>;    // custom request headers
  addParams?: Record<string, unknown>;  // add to request body
  dropParams?: string[];               // remove from request
  models: ModelRegistryEntry[];
};

type ModelRegistryEntry = {
  id: string;                    // slug or provider model id
  name: string;
  endpointId: string;
  enabled: boolean;
  capabilities: ModelCapabilities;
  contextWindow?: number;
  maxOutputTokens?: number;
  notes?: string;
};
```

### 5.2 Capability contract

Per-model capabilities live in `TModelSpec` (packages/data-provider/src/models.ts:11–40).

```typescript
// Extend TModelSpec with:
type TModelSpec = {
  // ... existing fields ...
  capabilities?: ModelCapabilities;
};

type ModelCapabilities = {
  chat: boolean;
  vision: boolean;
  files: boolean;
  toolCalling: boolean;
  structuredOutput: boolean;
  streaming: boolean;
  embeddings: boolean;
  rerank: boolean;
  reasoning: boolean;
};
```

**Bridge to endpoint-level flags:**
- Endpoint-level `Capabilities` enum (config.ts:208–214) and `AgentCapabilities` enum (`:216–230`) remain and describe product surface (what the control plane exposes as features).
- `interfaceSchema` toggles (`:724,737`) are global UI toggles; disabled if selected model lacks capability.
- **Capability enforcement rule:** Pre-`Run.create()` in Phase 3, request validation strips/rejects unsupported parts (vision → error, tools → drop+warn, structured output → fallback to text).

### 5.3 Citation/source contract

Used across Phases 4–7. GitHub sources are `kind: 'github'`.

```typescript
// packages/data-provider/src/types.ts (Phase 1 PR 1.1)
type Source = {
  id: string;                      // stable UUID or slug
  kind: 'web' | 'file' | 'github' | 'code' | 'memory';
  title: string;
  url?: string;
  snippet?: string;
  score?: number;                  // relevance/ranking score
  provider: string;                // search engine, file processor, GitHub, etc.
  
  legAttribution?: {
    legId: string;                 // which council leg discovered/used this (council mode only)
    role: 'direct' | 'inherited' | 'synthesized';
  };
  
  kindSpecific: 
    | {
        kind: 'web';
        domain: string;
        publishedAt?: string;      // ISO8601
        fetchedAt: string;         // ISO8601
      }
    | {
        kind: 'file';
        fileId: string;
        fileName: string;
        pages?: number[];
        fileType?: string;
      }
    | {
        kind: 'github';
        repo: string;              // owner/repo
        ref?: string;              // branch, tag, commit
        path?: string;             // file path
        lineStart?: number;
        lineEnd?: number;
        itemType?: 'repo' | 'file' | 'pr' | 'issue' | 'commit';
        itemId?: string;           // PR/issue/commit number or hash
      }
    | {
        kind: 'code';
        language: string;
        origin?: string;           // where it came from
      }
    | {
        kind: 'memory';
        entryId: string;
        createdAt: string;         // ISO8601
      };
};

// Inline citations in assistant messages (existing pattern, client/src/utils/citations.ts)
type InlineAnchor = {
  sourceId: string;                // refers to Source.id
  range?: [number, number];        // char offsets in source
};
```

**GitHub as source:** Phase 7 treats GitHub as a first-class **source provider** emitting citation-contract shapes (kind: 'github' with repo/path/itemType/itemId). Not a separate citation pathway.

---

## 6. Phase sequence (dependency-ordered)

### Phase 0 — Planning artifact (THIS DOCUMENT)
**Deliverable:** Authoritative reference map, risk catalog, unified contracts, phase sequence.  
**Accept when:** Artifact exists; all subsequent phases reference it.

### Phase 1 — Unified contract implementation & endpoint registry
**Dependencies:** Phase 0.  
**Deliverables:**
- PR 1.1: Capability namespace consolidation (extend TModelSpec; bridge existing endpoint-level flags).
- PR 1.2: Replace `providerConfigMap` hardcoded dict + `EndpointURLs` const with registry-driven lookup; preserve route shape and 7-provider snapshot tests byte-identical.
- PR 1.3: Pricing/transactions parity; `getMultiplier` lookups work for registry entries; snapshot tests for 7 providers.
- PR 1.4: Persisted `validationStatus` + `lastValidatedAt`; validation endpoint with user-scoped results (internal test harness only).  
**Cross-cutting gates:** `test:packages:data-provider`, `test:packages:data-schemas`, `test:packages:api` green; abort-mid-stream + Redis-resume smokes pass; existing YAML boots identical.

### Phase 2 — Capability-aware UI & pre-Run enforcement
**Dependencies:** Phase 1 (PR 1.1 contract + multi-select hook).  
**Deliverables:**
- PR 2.1: Client refactor (`useEndpoints.ts`, `ModelSelector.tsx`, `SetKeyDialog.tsx`, `ContentRender.tsx`); replace enum switches with capability-tag-driven logic; reuse Phase 1 hook contract.
- PR 2.2: Server pre-`Run.create()` gate; strip/reject unsupported parts by capability (vision → error, tools → drop+warn, structured output → prompt fallback).  
**Cross-cutting gates:** `test:client` + `test:api` green; capability-limited models reject unsupported parts with clear UX; abort-mid-tool-call + Redis-resume smokes pass; every new string localized.

### Phase 3 — External-inference hardening (docs-only, folded into Phase 8)
**Dependencies:** Phase 2.  
**Deliverables:** Docker docs updated (control-plane-only emphasis); `librechat.example.yaml` cleaned of misleading local-inference claims.

### Phase 4 — Council mode (bounded to 3, with 3 strategies & synthesis)
**Dependencies:** Phase 2 (capability gates); Phase 1 (citation-provenance shape).  
**Deliverables:**
- Design doc (pre-PR-4.2): Commits to synthesis-as-final-graph-node resume protocol; predeclares citation-provenance shape (per-leg attribution); locks token-budget policy (per-leg + synthesis, pre-check UI).
- PR 4.1: `councilAgents[]` schema (max length 2 extra → total ≤3 validated); flag-gated mapper change (retain all legs, not primary-only); parent/child `AbortController` hierarchy.
- PR 4.2: Three synthesis strategies (`primary_critic`, `best_of_three`, `compare_and_synthesize`); templated, sanitized prompts; synthesis streams as explicit `synthesis` part per resume protocol.
- PR 4.3: Client council toggle, strategy picker, ≤3-model picker, per-agent columns, synthesis card, token-budget pre-check, per-leg stop buttons, i18n.  
**Cross-cutting gates:** 1/2/3-model flows render + stream; stop-all + stop-one both correct; resume-before-synthesis and resume-during-synthesis distinct passing tests; pricing-parity test shows (N+1)×-expected transactions; `npm run e2e:ci` adds 3-model smoke; Redis-mode resume green; all new strings localized.

### Phase 5 — Retrieval, search, citations (concrete implementation)
**Dependencies:** Phase 1 (contract), Phase 4 (council synthesis outputs).  
**Deliverables:**
- PR 5.1: Normalized citation schema implementation; shape locked in Phase 1, now landed as types + validators.
- PR 5.2: Wire web search + file retrieval into schema; render via `Citation.tsx` + inline anchors; contract test locks JSON shape.  
**Cross-cutting gates:** Web-grounded answer shows clickable sources + inline anchors; file-grounded answer shows file citations; contract test passes.

### Phase 6 — Selective ragappv3 donor ports (retrieval quality)
**Dependencies:** Phase 5 (retrieval wiring).  
**Deliverables:** One PR porting top-5 by value/effort (fusion, prompt_builder, document_retrieval, schema_parser, query_transformer/step-back) as new TS modules under `packages/api/src/retrieval/`. Each port includes dependency-audit in PR body.  
**Rejects (confirmed):** `rag_engine.py`, `vector_store.py`, `document_processor.py`, local-mode `embeddings.py`/`reranking.py`.  
**Cross-cutting gates:** Ports unit-tested against fixtures from ragappv3 inputs; zero Python-only deps transplanted; each port cites donor file:line ranges in build report.

### Phase 7 — GitHub first-class (as source provider)
**Dependencies:** Phase 5 (citation contract with `kind: 'github'`), Phase 6 (retrieval foundation).  
**Deliverables:**
- PR 7.1: GitHub MCP server as first-class entry; OAuth/PAT via existing MCP user-connection machinery.
- PR 7.2: GitHub context selector (repo/file/PR/issue); hard-capped tool exposure via dedicated scoping layer (do **not** reuse `v1.js:110-171` agent-level filter).  
**Cross-cutting gates:** Connect GitHub MCP → attach repo file → run grounded answer; tool-name validation enforced; all new strings localized.

### Phase 8 — Deployment docs, cleanup, flag collapse
**Dependencies:** All prior phases.  
**Deliverables:** Docker/deployment docs (control-plane-only); `librechat.example.yaml` gains council + capability examples; release notes; CLAUDE.md updated (drop `/home/danny/agentus` claim); feature flags (council, capability enforcement, citations, GitHub) removed or collapsed (no temporary flags in shipped code); `npm run build` + `npm run test:all` clean.  
**Cross-cutting gates:** All feature flags removed or merged; e2e smoke suite updated; build clean.

---

## 7. Cross-cutting acceptance gates (enforced at every phase)

- **Existing librechat.yaml configurations must boot unchanged.** No breaking config schema changes; migrations must be automatic or clearly documented.
- **SSE/resumable semantics preserved.** Every phase touching streaming must pass: `abort-mid-stream`, `resume-after-disconnect`, `Redis-mode resume`, `abort-during-synthesis` (Phase 4+).
- **`npm run lint` clean; affected `test:*` suites green.** No lint warnings; no skipped tests.
- **New user-facing strings localized.** Every UI string routed through `useLocalize()`; `client/src/locales/en/translation.json` updated.
- **New surface behind env-var flag, default-off.** Council mode (`COUNCIL_MODE_ENABLED`), capability enforcement (`MODEL_CAPABILITY_ENFORCEMENT`), normalized citations (`UNIFIED_CITATION_SCHEMA`), GitHub first-class (`GITHUB_MCP_FIRST_CLASS`) — each independently controllable; not removed or collapsed until Phase 8.
- **Pricing/transactions parity test.** Every phase touching billing logic must include a test showing expected transaction count matches (single-model: 1 txn; council: ≤5 txns for 3 legs + synthesis + pre-check).
- **No force-pushes.** Linear commit history on branch.
- **Doc delta to migration notes and build report.** Every phase updates both files with section-specific findings.

---

## 8. Out of scope (explicit non-goals)

- Generalized autonomous swarm runtime or multi-turn agent chains.
- Background job orchestration or async task system beyond what @librechat/agents already provides.
- Recursive model chaining or unbounded agent recursion.
- Any Docker service that performs inference (no Ollama, vLLM, text-generation-webui, GPU runtime).
- Port of ragappv3's auth, routing, vault, or app orchestration model.
- Bypass of existing tool-allowlist (`v1.js:110-171`) semantics.
- Amendment of merged commits or rebase of submitted PRs.
- Full rewrite of the UI shell (preserve existing sidebar, chat surfaces, settings, attachment UX).
- Redesign of the message tree (preserve existing `parentMessageId` structure).

---

## 9. Donor portability reference (ragappv3)

### High-priority ports (feasible, high-value)

| Module | LOC | Algorithm | Deps | Portability | Value/effort |
|--------|-----|-----------|------|-------------|--------------|
| `fusion.py` | 86 | RRF + recency fusion | None | **PORT (clean)** | ⭐⭐⭐⭐⭐ |
| `prompt_builder.py` | 218 | Citation labels + framing | None | **PORT (clean)** | ⭐⭐⭐⭐⭐ |
| `document_retrieval.py` | 576 | Filter + window + dedup | None (pure logic) | **ADAPT (logic yes, RAG API adapter)** | ⭐⭐⭐⭐ |
| `schema_parser.py` | 130 | SQL DDL extraction | None | **PORT (clean)** | ⭐⭐⭐⭐ |
| `query_transformer.py` | 281 | Step-back + HyDE | LLMClient dep | **ADAPT (step-back portable; skip HyDE+Redis for MVP)** | ⭐⭐⭐ |

### Conditional ports (tight coupling, only if needed)

- `embeddings.py`: HTTP-based dual-provider OK; local torch-based REJECT.
- `reranking.py`: HTTP-based TEI OK; local sentence-transformers REJECT.
- `vector_store.py`: LanceDB is Python-only; no TS equivalent; REJECT.

### Anti-ports (do not port)

- `rag_engine.py`: Pure orchestration layer; rewrite in zaxbychat's stack.
- `document_processor.py`: Tangled with unstructured, pandas, sqlite, VectorStore.

---

## 10. Appendix: measured reference counts

Verified via `grep -rn EModelEndpoint` on branch `claude/review-swarm-plan-47MVq`:

- **packages/api/src:** 277 references across 50+ files
- **client/src:** 641 references across 80+ files
- **repo-wide:** 2,058 references across 204 files (excluding node_modules, dist, build)
- **Hardcoded provider list:** 7 entries (openai, google, azure, anthropic, bedrock, assistants, agents)

---

## 11. Next steps

- **User approval:** Confirm all decisions (locked in §2). ✅ **Done** (Q1–Q10 answered).
- **Phase 1 begins:** Implement unified contract + endpoint registry. Open as new PRs on branch `claude/review-swarm-plan-47MVq`.
- **Phase 0 success:** This document exists, no code; all downstream phases reference it.

---

**Document author:** Swarm investigation agents + independent critic (Opus, adversarial review), verified by user.  
**Locked decisions:** Q1–Q10 user answers.  
**Status:** Ready for Phase 1 execution.
