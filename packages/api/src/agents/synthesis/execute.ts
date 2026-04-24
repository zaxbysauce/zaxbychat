import { DEFAULT_SYNTHESIS_STRATEGY } from 'librechat-data-provider';
import type { Response } from 'express';
import type { LLMConfig } from '@librechat/agents';
import type { SynthesisStrategy, TMessage } from 'librechat-data-provider';
import type { SynthesisState, UsageMetadata } from '../../stream/interfaces/IJobStore';
import {
  extractLegOutputs,
  shouldRunSynthesis,
  prepareSynthesisPhase,
} from './orchestrator';
import { runCouncilSynthesis, skipCouncilSynthesisAllFailed } from './runner';
import { createAbortHierarchy } from '../../stream/abort';

type ContentPart = TMessage['content'] extends (infer U)[] | undefined ? U : never;

export interface CouncilExecutionInput {
  active: boolean;
  legAgentIds: string[];
  strategy?: SynthesisStrategy;
}

export interface CouncilAgentIdentity {
  legId: string;
  agentId: string;
  model: string;
}

export interface CouncilActivationSetup {
  legSignals: AbortSignal[];
  synthesisSignal: AbortSignal;
  legControllers: AbortController[];
  synthesisController: AbortController;
  dispose(): void;
}

/**
 * Constructs the council abort hierarchy using the primary request
 * AbortController as the parent. Returns per-leg signals the caller passes
 * to phase-1 execution and the synthesis signal the caller passes to phase-2.
 */
export function prepareCouncilAbortHierarchy(params: {
  parentController: AbortController;
  legCount: number;
}): CouncilActivationSetup {
  const hierarchy = createAbortHierarchy(params.parentController, params.legCount);
  return {
    legSignals: hierarchy.legs.map((c) => c.signal),
    synthesisSignal: hierarchy.synthesis.signal,
    legControllers: [...hierarchy.legs],
    synthesisController: hierarchy.synthesis,
    dispose() {
      /* placeholder for forward-compat */
    },
  };
}

export interface BuildLegIdentitiesParams {
  legAgentIds: string[];
  primaryAgentId: string;
  primaryModel: string;
  agentConfigs: Map<string, { id?: string; model?: string; provider?: string }>;
}

/**
 * Converts `legAgentIds` + `agentConfigs` into the `LegIdentity[]` shape the
 * synthesis template expects. The primary's agentId is first; each extra
 * follows the order it was added to agentConfigs during phase-1 load.
 */
export function buildLegIdentities(
  params: BuildLegIdentitiesParams,
): CouncilAgentIdentity[] {
  const { legAgentIds, primaryAgentId, primaryModel, agentConfigs } = params;
  const result: CouncilAgentIdentity[] = [];
  for (let i = 0; i < legAgentIds.length; i++) {
    const agentId = legAgentIds[i];
    if (agentId === primaryAgentId) {
      result.push({ legId: `leg-${i}`, agentId, model: primaryModel });
      continue;
    }
    const config = agentConfigs.get(agentId);
    const model = config?.model ?? 'unknown';
    result.push({ legId: `leg-${i}`, agentId, model });
  }
  return result;
}

export interface ExecutePhase2Params {
  res: Response;
  runId: string;
  streamId: string;
  synthesisSignal: AbortSignal;
  llmConfig: LLMConfig;
  council: CouncilExecutionInput & { legIdentities: CouncilAgentIdentity[] };
  userQuestion: string;
  contentParts: readonly ContentPart[];
  collectedUsage: UsageMetadata[];
  setSynthesisState: (partial: Partial<SynthesisState>) => Promise<void>;
}

export type ExecutePhase2Outcome =
  | { ran: false; reason: 'inactive' | 'single_leg_no_extras' | 'aborted' }
  | { ran: false; reason: 'all_legs_failed'; legStatus: SynthesisState['legStatus'] }
  | { ran: true; partial: boolean; emittedText: string; completed: boolean };

/**
 * Orchestrates phase 2 of a council job. Caller invokes this AFTER phase 1
 * completes — typically after `await runAgents(initialMessages)` in
 * AgentClient.chatCompletion.
 *
 * Branches per §D5:
 *   - Council inactive → no-op
 *   - Primary ran alone (all extras failed to load) → no-op
 *   - ≥1 leg succeeded → synthesis runs, usage rows tagged `__synthesis__`
 *   - All legs failed → skip, emit synthesis_skipped_all_failed, no fake output
 */
export async function executeCouncilPhase2(
  params: ExecutePhase2Params,
): Promise<ExecutePhase2Outcome> {
  const { council, synthesisSignal } = params;

  if (!council.active || council.legAgentIds.length <= 1) {
    return { ran: false, reason: 'inactive' };
  }
  if (synthesisSignal.aborted) {
    return { ran: false, reason: 'aborted' };
  }

  const legs = extractLegOutputs({
    contentParts: params.contentParts,
    legIdentities: council.legIdentities,
  });

  const decision = shouldRunSynthesis(legs);
  if (!decision.run) {
    if (decision.reason === 'all_legs_failed') {
      const legStatus = legs.map((l) => ({
        legId: l.legId,
        agentId: l.agentId,
        model: l.model,
        status: l.status,
        ...(l.error != null ? { error: l.error } : {}),
      }));
      await skipCouncilSynthesisAllFailed({
        res: params.res,
        legStatus,
        strategy: council.strategy ?? DEFAULT_SYNTHESIS_STRATEGY,
        setSynthesisState: params.setSynthesisState,
      });
      return { ran: false, reason: 'all_legs_failed', legStatus };
    }
    return { ran: false, reason: decision.reason };
  }

  const { state, prompt } = prepareSynthesisPhase({
    userQuestion: params.userQuestion,
    strategy: council.strategy ?? DEFAULT_SYNTHESIS_STRATEGY,
    legs,
  });

  await params.setSynthesisState({
    strategy: state.strategy,
    started: false,
    completed: false,
    emittedIndex: 0,
    legStatus: state.legStatus,
    partial: state.partial,
  });

  const result = await runCouncilSynthesis({
    res: params.res,
    runId: params.runId,
    streamId: params.streamId,
    abortSignal: synthesisSignal,
    llmConfig: params.llmConfig,
    prompt,
    collectedUsage: params.collectedUsage,
    setSynthesisState: params.setSynthesisState,
  });

  return {
    ran: true,
    partial: prompt.partial,
    emittedText: result.emittedText,
    completed: result.completed,
  };
}
