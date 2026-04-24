import { atom } from 'recoil';
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
