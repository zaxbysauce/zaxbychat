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
