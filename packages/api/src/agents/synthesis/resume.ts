import { SYNTHESIS_AGENT_ID } from 'librechat-data-provider';
import type { SynthesisState } from '../../stream/interfaces/IJobStore';

export type SynthesisResumePhase = 'pre_synthesis' | 'mid_synthesis' | 'post_synthesis';

/**
 * One replay event the resume protocol should emit when picking up a council
 * job mid-flight. The caller wires each event into its existing SSE emitter.
 *
 * Shape of each event mirrors the client's existing `capability_notice` /
 * `attachment` pattern — a discriminated object on the custom SSE channel.
 */
export type SynthesisResumeEvent =
  | { kind: 'synthesis_start'; strategy: SynthesisState['strategy']; legStatus: SynthesisState['legStatus']; partial: boolean }
  | { kind: 'synthesis_delta'; text: string }
  | { kind: 'synthesis_complete'; text: string; partial: boolean; legStatus: SynthesisState['legStatus'] }
  | { kind: 'synthesis_skipped_all_failed'; legStatus: SynthesisState['legStatus'] };

export interface BuildReplayInput {
  state?: SynthesisState;
  /** Characters already delivered to this resumer (e.g. from prior subscription). */
  clientAlreadyHas?: number;
}

export interface BuildReplayResult {
  phase: SynthesisResumePhase | 'no_state';
  events: SynthesisResumeEvent[];
}

/**
 * Computes the sequence of synthesis replay events needed to bring a resuming
 * client up to date, given the persisted synthesis state. Pure function.
 *
 *   no state            → phase='no_state', no events; fall through to
 *                         the pre-existing pendingEvents leg-buffer replay.
 *   started=false       → phase='pre_synthesis', no synthesis events; pre-synthesis
 *                         resume is entirely handled by the existing leg-event buffer.
 *   started=true, !done → phase='mid_synthesis', emits synthesis_start (if client
 *                         has 0 chars) + a synthesis_delta covering chars from
 *                         clientAlreadyHas..emittedIndex.
 *   started=true, done  → phase='post_synthesis', emits synthesis_start +
 *                         synthesis_delta for the full text + synthesis_complete.
 *
 * When `legStatus` has a 'failed' entry AND no 'succeeded' entry AND
 * `completed===true` with no text, the replay emits a single
 * `synthesis_skipped_all_failed` event so the client can render the
 * all-fail branch correctly per §D5.
 */
export function buildSynthesisResumeReplay(input: BuildReplayInput): BuildReplayResult {
  const { state, clientAlreadyHas = 0 } = input;

  if (!state) {
    return { phase: 'no_state', events: [] };
  }

  if (!state.started) {
    return { phase: 'pre_synthesis', events: [] };
  }

  const allFailed =
    state.legStatus.length > 0 && state.legStatus.every((l) => l.status === 'failed');

  if (allFailed && state.completed && !state.text) {
    return {
      phase: 'post_synthesis',
      events: [
        {
          kind: 'synthesis_skipped_all_failed',
          legStatus: state.legStatus,
        },
      ],
    };
  }

  const events: SynthesisResumeEvent[] = [];

  if (clientAlreadyHas === 0) {
    events.push({
      kind: 'synthesis_start',
      strategy: state.strategy,
      legStatus: state.legStatus,
      partial: state.partial,
    });
  }

  if (state.completed) {
    const fullText = state.text ?? '';
    if (fullText.length > clientAlreadyHas) {
      events.push({ kind: 'synthesis_delta', text: fullText.slice(clientAlreadyHas) });
    }
    events.push({
      kind: 'synthesis_complete',
      text: fullText,
      partial: state.partial,
      legStatus: state.legStatus,
    });
    return { phase: 'post_synthesis', events };
  }

  if (state.emittedIndex > clientAlreadyHas) {
    const partialText = (state.text ?? '').slice(clientAlreadyHas, state.emittedIndex);
    if (partialText.length > 0) {
      events.push({ kind: 'synthesis_delta', text: partialText });
    }
  }
  return { phase: 'mid_synthesis', events };
}

/**
 * Convenience factory for a fresh synthesis state at kick-off of the
 * synthesis node. Kept colocated so the state shape stays DRY.
 */
export function initialSynthesisState(
  strategy: SynthesisState['strategy'],
  legStatus: SynthesisState['legStatus'],
): SynthesisState {
  const partial =
    legStatus.some((l) => l.status === 'failed') && legStatus.some((l) => l.status === 'succeeded');
  return {
    strategy,
    started: false,
    completed: false,
    emittedIndex: 0,
    legStatus,
    partial,
  };
}

/** Re-export for callers that need the reserved agent id. */
export { SYNTHESIS_AGENT_ID };
