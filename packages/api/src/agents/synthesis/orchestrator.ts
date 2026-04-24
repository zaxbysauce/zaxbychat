import { SYNTHESIS_AGENT_ID } from 'librechat-data-provider';
import type { Response } from 'express';
import type { TMessage } from 'librechat-data-provider';
import type { SynthesisState } from '../../stream/interfaces/IJobStore';
import type { LegSummary, SynthesisPromptInput } from './templates';
import type { SynthesisResumeEvent } from './resume';
import { buildSynthesisPrompt } from './templates';
import { initialSynthesisState } from './resume';

type ContentPart = TMessage['content'] extends (infer U)[] | undefined ? U : never;

interface PartWithAgent {
  type?: string;
  text?: string;
  agentId?: string;
  groupId?: number;
}

export interface LegIdentity {
  legId: string;
  agentId: string;
  model: string;
}

export interface ExtractLegOutputsParams {
  contentParts: readonly ContentPart[];
  legIdentities: readonly LegIdentity[];
}

/**
 * Classifies per-leg outputs from the phase-1 run's accumulated contentParts.
 *
 * Inputs:
 *   - contentParts: the live `AgentClient.contentParts` after phase 1 completes.
 *     Parts carry `agentId` and `groupId` metadata while the run is active
 *     (metadata is stripped later at persist time by `createMultiAgentMapper`).
 *   - legIdentities: the known leg configuration (primary + extras, with
 *     their agent ids and models), from `councilResult.legAgentIds`.
 *
 * Output: one `LegSummary` per leg, with `status='succeeded'` if the leg
 * produced any text content, `'failed'` otherwise. Pure function.
 */
export function extractLegOutputs(params: ExtractLegOutputsParams): LegSummary[] {
  const { contentParts, legIdentities } = params;

  const textByAgent = new Map<string, string>();
  for (const part of contentParts) {
    const p = part as PartWithAgent;
    if (p?.type !== 'text' || typeof p.text !== 'string' || !p.agentId) {
      continue;
    }
    const prior = textByAgent.get(p.agentId) ?? '';
    textByAgent.set(p.agentId, prior + p.text);
  }

  return legIdentities.map((identity, i) => {
    const text = textByAgent.get(identity.agentId);
    if (text && text.length > 0) {
      return {
        legId: identity.legId || `leg-${i}`,
        agentId: identity.agentId,
        model: identity.model,
        status: 'succeeded',
        text,
      };
    }
    return {
      legId: identity.legId || `leg-${i}`,
      agentId: identity.agentId,
      model: identity.model,
      status: 'failed',
    };
  });
}

export interface ShouldRunSynthesisResult {
  run: boolean;
  reason:
    | 'ok'
    | 'all_legs_failed'
    | 'single_leg_no_extras'
    | 'no_legs';
}

/**
 * Decides whether synthesis should execute given the extracted leg summaries.
 * Runs when at least one leg succeeded AND more than one leg was attempted
 * (a single primary-only call is not a council). Aligned with §D5.
 */
export function shouldRunSynthesis(legs: readonly LegSummary[]): ShouldRunSynthesisResult {
  if (legs.length === 0) {
    return { run: false, reason: 'no_legs' };
  }
  if (legs.length === 1) {
    return { run: false, reason: 'single_leg_no_extras' };
  }
  const anySucceeded = legs.some((l) => l.status === 'succeeded');
  if (!anySucceeded) {
    return { run: false, reason: 'all_legs_failed' };
  }
  return { run: true, reason: 'ok' };
}

/**
 * Produces the initial SynthesisState alongside the built prompt for phase 2.
 * Bundles both so callers don't recompute legStatus / partial from the same legs.
 */
export function prepareSynthesisPhase(params: {
  userQuestion: string;
  strategy: SynthesisState['strategy'];
  legs: readonly LegSummary[];
}): {
  state: SynthesisState;
  prompt: ReturnType<typeof buildSynthesisPrompt>;
} {
  const legStatus = params.legs.map((l) => ({
    legId: l.legId,
    agentId: l.agentId,
    model: l.model,
    status: l.status,
    ...(l.error != null ? { error: l.error } : {}),
  }));
  const state = initialSynthesisState(params.strategy, legStatus);
  const promptInput: SynthesisPromptInput = {
    strategy: params.strategy,
    userQuestion: params.userQuestion,
    legs: [...params.legs],
  };
  const prompt = buildSynthesisPrompt(promptInput);
  return { state, prompt };
}

/**
 * Writes a custom SSE event to the response stream. Returns `false` if `res`
 * is unavailable or the stream has ended, so callers can detect lost clients.
 * Non-throwing.
 */
function writeSynthesisEvent(
  res: Response | undefined,
  eventName: string,
  payload: unknown,
): boolean {
  if (!res || typeof res.write !== 'function' || res.writableEnded) {
    return false;
  }
  try {
    res.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
    return true;
  } catch {
    return false;
  }
}

export function emitSynthesisStart(
  res: Response | undefined,
  params: {
    strategy: SynthesisState['strategy'];
    legStatus: SynthesisState['legStatus'];
    partial: boolean;
  },
): boolean {
  return writeSynthesisEvent(res, 'synthesis_start', {
    agentId: SYNTHESIS_AGENT_ID,
    strategy: params.strategy,
    legStatus: params.legStatus,
    partial: params.partial,
  });
}

export function emitSynthesisDelta(res: Response | undefined, text: string): boolean {
  return writeSynthesisEvent(res, 'synthesis_delta', {
    agentId: SYNTHESIS_AGENT_ID,
    text,
  });
}

export function emitSynthesisComplete(
  res: Response | undefined,
  params: {
    text: string;
    partial: boolean;
    legStatus: SynthesisState['legStatus'];
  },
): boolean {
  return writeSynthesisEvent(res, 'synthesis_complete', {
    agentId: SYNTHESIS_AGENT_ID,
    text: params.text,
    partial: params.partial,
    legStatus: params.legStatus,
  });
}

export function emitSynthesisSkippedAllFailed(
  res: Response | undefined,
  params: { legStatus: SynthesisState['legStatus'] },
): boolean {
  return writeSynthesisEvent(res, 'synthesis_skipped_all_failed', {
    agentId: SYNTHESIS_AGENT_ID,
    legStatus: params.legStatus,
  });
}

/**
 * Plays a pre-computed `SynthesisResumeEvent[]` (from `buildSynthesisResumeReplay`)
 * into the provided `res`. Stops and returns the count of events actually
 * written when `res` rejects a write.
 */
export function replaySynthesisEvents(
  res: Response | undefined,
  events: readonly SynthesisResumeEvent[],
): number {
  let written = 0;
  for (const event of events) {
    let ok = false;
    switch (event.kind) {
      case 'synthesis_start':
        ok = emitSynthesisStart(res, {
          strategy: event.strategy,
          legStatus: event.legStatus,
          partial: event.partial,
        });
        break;
      case 'synthesis_delta':
        ok = emitSynthesisDelta(res, event.text);
        break;
      case 'synthesis_complete':
        ok = emitSynthesisComplete(res, {
          text: event.text,
          partial: event.partial,
          legStatus: event.legStatus,
        });
        break;
      case 'synthesis_skipped_all_failed':
        ok = emitSynthesisSkippedAllFailed(res, { legStatus: event.legStatus });
        break;
      default: {
        const exhaustive: never = event;
        throw new Error(`replaySynthesisEvents: unknown event kind ${String(exhaustive)}`);
      }
    }
    if (!ok) {
      break;
    }
    written += 1;
  }
  return written;
}

export { SYNTHESIS_AGENT_ID };
