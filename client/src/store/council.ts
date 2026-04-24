import { atom, atomFamily } from 'recoil';
import { DEFAULT_SYNTHESIS_STRATEGY } from 'librechat-data-provider';
import type { CouncilAgentSpec, SynthesisStrategy } from 'librechat-data-provider';

export interface CouncilComposerState {
  enabled: boolean;
  strategy: SynthesisStrategy;
  extras: CouncilAgentSpec[];
}

/**
 * Phase 4 council composer state. Held in recoil so the toggle, strategy,
 * and extras persist across renders and reset on conversation switches.
 * When `enabled === false`, the client never sends `councilAgents` on a
 * chat request (the flag is off at the composer level even if
 * `interfaceConfig.council` is true deployment-wide).
 */
export const councilComposerState = atom<CouncilComposerState>({
  key: 'councilComposerState',
  default: {
    enabled: false,
    strategy: DEFAULT_SYNTHESIS_STRATEGY,
    extras: [],
  },
});

export type CouncilLegLive = {
  legId: string;
  agentId: string;
  model?: string;
  status: 'succeeded' | 'failed' | 'unknown';
  error?: string;
};

/**
 * Live synthesis stream state populated by the synthesis_* SSE events
 * (c7c). Keyed per conversationId so multi-tab scenarios stay isolated.
 * Null when no council run is active for this conversation.
 */
export interface SynthesisLiveState {
  conversationId: string;
  strategy: SynthesisStrategy;
  legStatus: CouncilLegLive[];
  text: string;
  status: 'pending' | 'streaming' | 'complete' | 'skipped_all_failed';
  partial: boolean;
}

export const synthesisLiveStateFamily = atomFamily<SynthesisLiveState | null, string>({
  key: 'synthesisLiveState',
  default: null,
});
