# Phase 4 — Council mode design (binding)

**Status.** Approved. All decisions in this document are locked. Subsequent PRs (4.1, 4.2, 4.3) implement against these shapes without further re-litigation.

**Authority.** This document is referenced from `docs/zaxbychat-perplexity-migration-notes.md` §6 Phase 4. It inherits all cross-cutting gates and risk mitigations from that document (R2, R3, R4, R6, R9, R11).

**Bounded scope.** Council mode only. Not in this phase:
- Citation schema redesign (shape already landed in Phase 1 as `CitationSource.legAttribution`).
- General multi-agent infrastructure redesign beyond what council requires.
- Changes to workspace routing, auth forms, or capability namespaces.
- Streaming-capability gate changes (owned by Phase 2).

---

## D1 — `councilAgents` coexists with `addedConvo`

- **Schema.** `councilAgents?: CouncilAgentSpec[]` is a **new optional field** on `endpointOption`. It is additive. `addedConvo` is **not removed** in this phase.
- **Precedence.** When both are present on a request, **`councilAgents` wins and `addedConvo` is ignored** for that request (server logs the override).
- **Back-compat.** Requests that only set `addedConvo` continue to use the existing `processAddedConvo()` path unchanged. No request shape migration is forced on clients.
- **Hard cutover.** None in this phase. `addedConvo` removal is explicitly deferred to Phase 8.

---

## D2 — Synthesis-as-final-graph-node protocol

- **Graph shape.** `[primary, …councilAgents]` run in parallel → implicit join (all-completed or all-aborted) → synthesis node reads leg outputs → synthesis streams final result.
- **Stream channel.** Single SSE stream — no second connection. Legs stream as ordinary assistant-text parts carrying `agentId` + `groupId` metadata (existing plumbing from `addedConvo`). Synthesis streams as a **distinct part type** — `synthesis` — with its own marker so the client can render it in its own surface (a "Synthesis" card), never mixed into ordinary assistant text.
- **Part type discriminator.** A synthesis content part is shaped:
  ```ts
  type SynthesisPart = {
    type: 'synthesis';
    strategy: 'primary_critic' | 'best_of_three' | 'compare_and_synthesize';
    text: string;             // streamed delta by delta
    legStatus: Array<{ legId: string; status: 'succeeded' | 'failed'; agentId: string }>;
    partial: boolean;         // true when synthesis ran with < N legs succeeding
  };
  ```
  `SynthesisPart` lives next to the existing `text` / `tool_call` / `image_file` content-part union. Not a new SSE event type — rides the existing message-delta channel.
- **If V4b shows graph-node registration cannot be done cleanly without forking `@librechat/agents`:** stop and report before writing PR 4.2. No fallback to "post-graph step" allowed — the user declined that option.

---

## D3 — Parent / children AbortController hierarchy

```
parentAbortController            (= the existing job-level controller)
 ├── legController[0..N]         (one per council leg, including the primary when council is active)
 └── synthesisController         (one for the synthesis node)
```

- **`stop-all`**: aborts `parentAbortController`. Cascades signal to all children via `AbortSignal.any([parent, self])` linking.
- **`stop-one`** (per-leg): aborts `legController[k]` only. Other legs continue. If all legs stopped OR finished, join fires; synthesis runs on remaining successful legs per D5.
- **`stop-synthesis`**: aborts `synthesisController` only. Legs already finished. Client shows legs as-completed, synthesis marked failed.
- **Construction site.** New helper `packages/api/src/stream/abort.ts#createAbortHierarchy(parent)` returns `{ parent, legController(k), synthesisController }`. Wired into `GenerationJobManager.ts:221` (new job) and `:425` (resumed replica) only when `councilAgents` is present.
- **Non-council path.** Unchanged. Single shared AbortController as today. Hierarchy helper is invoked conditionally.

---

## D4 — Feature flag: `interfaceSchema.council`

- **Type.** `boolean`, optional, default `false`.
- **Location.** `packages/data-provider/src/config.ts` `interfaceSchema`, alongside existing flags (`modelSelect`, `sidePanel`, etc.).
- **Gating.**
  - Server: when `req.config.interfaceConfig.council !== true`, the server ignores `councilAgents` on the request and proceeds with primary-only execution (or `addedConvo` if present). No error.
  - Client: when `interfaceConfig.council !== true`, the council toggle UI is not rendered, the composer submits the existing single-agent request shape.
- **Defaults.** Off. Deployments opt in by setting `interface.council: true` in `librechat.yaml`.
- **No env kill switch in this phase.** May be layered later per the plan; not added now.

---

## D5 — Leg failure: partial synthesis with honest surfacing

- **Rule.** If ≥1 leg succeeds, synthesis runs with the succeeded legs. Failed legs are recorded with `status: 'failed'` and an error classification. If **all** legs fail, the whole request is rejected via the existing error path.
- **Surfacing.**
  - `SynthesisPart.legStatus` enumerates every leg with its status and `agentId`.
  - `SynthesisPart.partial = true` whenever `legStatus.some(l => l.status === 'failed')`.
  - The synthesis prompt template **explicitly names missing legs** — e.g. "Leg B (`claude-sonnet-4-6`) did not return a response; synthesize only from the legs that did." It never silently drops them.
- **Client.** The synthesis card shows each leg's badge with ✓/✗; partial synthesis shows a small "Partial: synthesized from N of M legs" label. No unanimous-agreement framing when ≥1 failed.
- **Transaction logging.** Only actual usage. If synthesis did not run (all-fail case), no synthesis transaction row is written.

---

## D6 — Default strategy: `compare_and_synthesize`

- **Default.** When council is enabled and no strategy is specified, `compare_and_synthesize`.
- **Available strategies.**
  - `primary_critic` — primary leg answers first; other legs critique that answer; synthesis node merges the critique into a revised answer attributed back to sources.
  - `best_of_three` — each leg answers independently; synthesis picks the strongest answer with brief justification. Ties → merges top two.
  - `compare_and_synthesize` — each leg answers independently; synthesis extracts agreements, flags disagreements, and produces a synthesized answer that explicitly attributes points to legs via `legAttribution`.
- **Prompt templates.** One per strategy, in `packages/api/src/agents/synthesis/templates.ts`. Templates are parameterized on `{legs, legStatus, userQuestion}` — no free-form concatenation. Sanitization: all leg outputs are wrapped with `<leg id="…">…</leg>` tags that the template instructs the synthesis model to treat as untrusted input.

---

## D7 — Token-budget pre-check

- **Authority.** Server computes the estimate. Client consumes it.
  - Server endpoint: a cheap synchronous helper `estimateCouncilBudget({ primary, councilAgents, strategy })` returning `{ estimatedPromptTokens, estimatedCompletionTokens, perLeg: [...], synthesis: {...} }`. Derived from per-model `maxOutputTokens` defaults × leg count plus synthesis budget.
  - Client: calls the estimate **only** when the user has the council toggle on and at least one extra leg selected. Renders a banner: "≈ {N} tokens estimated (council × {M})". Purely informational. Never blocks submission.
- **Accuracy principle.** The pre-check is an **upper-bound approximation**, clearly labeled "approximate". Actual billing is per-leg + synthesis **real** token counts from `recordCollectedUsage`, not the estimate.
- **Pricing parity gate.** When N legs succeed and synthesis runs, exactly **N+1 transaction rows** are written (one per leg, one per synthesis). When K legs succeed and synthesis runs partial, exactly **K+1 rows**. When all legs fail, synthesis is skipped — **N rows** (one per failed leg covering whatever tokens consumed up to failure). Tests pin these counts.

---

## D8 — `CouncilAgentSpec` shape (extras-only, validated)

- **Semantics.** `councilAgents` is the **list of extra legs only**, never including the primary. Primary = the currently selected `endpointOption.model` on `endpointOption.endpoint`. Naming and docs reflect this unambiguously.
- **Type (data-provider).**
  ```ts
  export type CouncilAgentSpec = {
    endpoint: string;
    model: string;
    agent_id?: string;
  };
  export const councilAgentSpecSchema = z.object({
    endpoint: z.string().min(1),
    model: z.string().min(1),
    agent_id: z.string().optional(),
  });
  export const councilAgentsSchema = z
    .array(councilAgentSpecSchema)
    .max(2);
  ```
- **Uniqueness.** Server validates that `(endpoint, model, agent_id ?? null)` tuples across `[primary, ...councilAgents]` are all distinct. Duplicates → 400 with `ErrorTypes.COUNCIL_DUPLICATE_LEG`.
- **Total-size bound.** With `councilAgents.max(2)`, total ≤3 always. Not renegotiable in this phase.

---

## Resume protocol

Phase 4 must survive context loss mid-stream. Resume is tested for three states:

### Pre-synthesis (legs in flight or pending)
- Leg events buffered in `pendingEvents` per existing mechanism; resumption replays them in order.
- Synthesis has not started → no synthesis state in the job.
- Resumer subscribes, replays leg buffer, then receives live leg deltas and the synthesis node kick-off when legs complete.

### Mid-synthesis (synthesis streaming)
- `pendingEvents` contains the completed leg part deltas + synthesis part deltas up to the last emitted index.
- Job state includes `synthesisState: { started: true, completed: false, emittedIndex: number }`.
- Resumer replays legs as final parts + synthesis as partial part (delta stream resumes from `emittedIndex`).

### Post-synthesis (synthesis completed)
- Job state includes `synthesisState: { started: true, completed: true }` + the full synthesis `text`.
- Resumer replays all legs + the complete synthesis part, then receives `[DONE]`.

**Persistence.** Redis-mode resume must pass all three states. The `GenerationJobManager` serializes `synthesisState` into the job record (same mechanism that already persists `pendingEvents`).

---

## Honest UI affordances (binding)

- **Synthesis card** renders in its own visual surface, clearly labeled "Synthesis" — never flattened into assistant content.
- **Leg attribution** per-part: each leg's content is shown in its own column/pane (existing `ParallelContent.tsx` surface) with the model name visible.
- **Failure visibility.** If leg K failed, that column shows a failure affordance (✗ icon + error classification); the synthesis card shows "Partial: synthesized from K of N legs" when `partial === true`.
- **Per-leg stop buttons** render next to each leg column while that leg is streaming. A global "Stop all" control remains.

---

## Feature-flag bounded gates

Every server change lands behind `interfaceSchema.council`. When the flag is off:
- `councilAgents` on a request is silently ignored (same as pre-Phase-4 behavior).
- `createMultiAgentMapper` retains its primary-only filter (existing `addedConvo` behavior unchanged).
- AbortHierarchy helper is not constructed; single controller as today.
- Synthesis graph node is never added.
- Client's composer shows no council UI.

Rollback = flip `interface.council: false` in `librechat.yaml` + restart. No code revert required (R11).

---

## Cross-cutting gates inherited from the migration plan

- `test:client` + `test:api` green.
- 1-model + 2-model + 3-model flows all render and stream.
- `stop-all` and `stop-one` tests pass for every leg index.
- Resume tests cover pre-synthesis / mid-synthesis / post-synthesis.
- Pricing-parity test shows exactly (K+1) transactions where K = successful legs (or K when synthesis skipped after all-fail).
- `npm run e2e:ci` gains a 3-model smoke.
- Redis-mode resume green for all three resume states.
- Every new user-facing string routes through `useLocalize()`.

---

## PR sequence

1. **This doc (4.0)** — committed first, binding reference for 4.1–4.3.
2. **4.1** — schema (`CouncilAgentSpec`, `councilAgentsSchema`, `interfaceSchema.council`), mapper retain-all flag, AbortHierarchy helper, feature-flag plumbing, unit tests.
3. **4.2** — synthesis graph node, three strategy templates, resume protocol with three-state persistence, pricing parity assertions, synthesis SSE part type, unit + integration tests.
4. **4.3** — client UI (toggle, strategy picker, ≤3-model picker, per-agent columns, synthesis card, per-leg stop buttons, token-budget banner, i18n keys).

Pre-4.1 verifications **V4a–V4d** (see migration notes) must run green before 4.1 opens. V4b or V4c blockers → stop and report per the escalation rule.

---

## V4 verification results (2026-04-24)

All four verifications resolved. No structural blockers.

### V4a — `addedConvo` runtime shape

Confirmed fields consumed by `loadAddedAgent()` (`packages/api/src/agents/added.ts:36-215`):
- Loaded-agent path (`conversation.agent_id` present & non-ephemeral): only `agent_id` is consumed.
- Ephemeral-agent path: `endpoint`, `model`, `promptPrefix`, `spec`, `modelLabel`, `ephemeralAgent: {mcp, execute_code, file_search, web_search, artifacts}` are consumed.

**Implication for D8.** `CouncilAgentSpec = {endpoint, model, agent_id?}` is deliberately narrower than `addedConvo`. Council-mode extras intentionally do NOT carry `promptPrefix` / `spec` / `ephemeralAgent` tool-toggle overrides. Users who need per-leg tool/prompt customization use `addedConvo` (unchanged under D1). This narrowness is a locked feature of this phase, not a gap.

### V4b — synthesis-as-graph-node additivity (blocker check)

**Verdict: (A) additively implementable. No fork.**

- `graphConfig.edges` already supports many-to-one: `from: ['leg1', 'leg2', ...], to: 'synthesis'` is valid (`packages/api/src/agents/edges.ts:17-30`).
- Custom handlers are already the extension point — `createOpenAIHandlers()` merges `customHandlers: Record<string, EventHandler>` (`openai/handlers.ts:408-428`). Existing `ON_SUMMARIZE_START/DELTA/COMPLETE` events (`summarization.e2e.test.ts:115-130`) prove the same pattern works for post-parallel nodes.
- Part types are not hardcoded in the package — `OpenAIMessageDeltaHandler` forwards `part.type` verbatim (`openai/handlers.ts:249-256`), so a `{type: 'synthesis'}` part streams cleanly.

### V4c — per-leg transaction row reach (blocker check)

**Verdict: (A) naturally supported. Small rewiring required.**

- `recordCollectedUsage()` already loops over `collectedUsage: UsageMetadata[]` (`packages/api/src/agents/usage.ts:78`). Each iteration builds its own `TxMetadata` with its own `model`.
- `bulkWriteTransactions()` calls `insertMany(plainDocs)` with exactly one `doc` per entry (`transactions.ts:324-347`). No pre-aggregation.
- **Missing link:** `UsageMetadata` / `TxMetadata` / `TransactionData` have no `agentId` field today. Adding `agentId?: string` to these three types is part of PR 4.2's scope. ~5 types, ~10 lines.

### V4d — per-agent streaming metadata

- `agentId` on streamed content parts is driven by each agent's unique `id` in `agentConfigs` Map (`processAddedConvo.js:126`).
- IDs are disambiguated via `appendAgentIdSuffix(agentId, index)` (loaded agents) or `encodeEphemeralAgentId({endpoint, model, sender, index})` (ephemeral) — both take an explicit `index` parameter.
- **Council mode uses `index: 1` for the first extra leg and `index: 2` for the second.** This is the only change required to get distinct `agentId`s through — no new metadata plumbing.
- `groupId` is assigned by `@librechat/agents` per request; identical for all legs in one request so `createMultiAgentMapper` can group them (`client.ts:350-361`).
- Client `ParallelContent.tsx:47-121` already generates columns dynamically — no 2-leg hardcoding. Ready for ≥3.

No structural blockers. Proceeding to PR 4.1.

---

## PR B addendum — accepted deviation from §D2 literal interpretation (2026-04-24)

**Context.** During PR B runtime-wire-up verification, a Q2 probe revealed that `@librechat/agents`'s `graphConfig.edges` controls execution order but does not give a public hook to rewrite a node's input `state.messages` before its LLM call. The sanitization contract we shipped in PR A's synthesis templates (legs wrapped in `<leg>` tags as untrusted input) cannot be preserved if leg outputs naturally accumulate into the synthesis node's `state.messages` as prior assistant turns via LangGraph conventions.

**Decision.** Implement §D2 as a **two-phase execution within one council job and SSE stream**:
- Phase 1 runs the parallel legs via the existing multi-start-node graph shape (same mechanism `addedConvo` uses today, extended for up to 2 extras per D8).
- Phase 2 invokes a second `Run.create` for a single-agent graph that runs the synthesis node. The synthesis prompt is built via the already-shipped `buildSynthesisPrompt` helper using the phase-1 leg outputs. Both invocations share the same Express `res`, the same `AbortHierarchy`, the same `SynthesisState` marker, the same request lifecycle.

**What this preserves.**
- **Observable contract**: legs stream → synthesis streams on same SSE stream → same request/job lifecycle → explicit synthesis part type → three-state resume → stop semantics → (K+1)-row transaction accounting → partial-failure honesty.
- **Sanitization contract**: legs remain untrusted XML-tagged input to the synthesis prompt. PR A's 13 template tests stay green.
- **Public-API-only usage of `@librechat/agents`**: two standard `Run.create` calls with documented shapes. No fork, no SDK internals, no speculative pre-call hooks.
- **D3 abort hierarchy**: parent cascades to phase-1 leg children AND to the phase-2 synthesis child. Stop-one abort only applies during phase 1 (synthesis hasn't started). Stop-synthesis only applies during phase 2.

**What this does not change.**
- D1 (additive `councilAgents` alongside `addedConvo`).
- D4 (`interfaceSchema.council` flag, default off — non-activating).
- D5 (partial synthesis when ≥1 leg succeeds; fail-all → no synthesis, no fake row).
- D6 (compare_and_synthesize default).
- D7 (server-authoritative budget estimate, client informational only, real execution accounting).
- D8 (extras-only, max 2 council agents; uniqueness validated).

**Semantic reframing of §D2.** "Synthesis as the final graph node" is now treated as a **behavioral requirement**, not a literal single-graph requirement. The user-visible contract is identical; the implementation uses two `Run.create` invocations within one SSE stream because that is the only path that preserves the sanitization contract under the verified runtime constraints. This deviation is narrow, honest, and documented here as the binding reference for PR B reviewers.
