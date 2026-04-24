import { useCallback, useMemo } from 'react';
import { useRecoilState } from 'recoil';
import {
  MAX_COUNCIL_EXTRAS,
  councilAgentsSchema,
  validateCouncilComposition,
  DEFAULT_SYNTHESIS_STRATEGY,
} from 'librechat-data-provider';
import type {
  CouncilAgentSpec,
  SynthesisStrategy,
} from 'librechat-data-provider';
import { councilComposerState } from '~/store';
import type { CouncilComposerState } from '~/store/council';

export interface UseCouncilStateResult {
  state: CouncilComposerState;
  isFull: boolean;
  setEnabled: (enabled: boolean) => void;
  setStrategy: (strategy: SynthesisStrategy) => void;
  addExtra: (extra: CouncilAgentSpec) => boolean;
  removeExtra: (index: number) => void;
  reset: () => void;
  /**
   * Returns a validated `CouncilAgentSpec[]` safe to put on the outbound
   * chat payload, OR null when the composer is off / empty / invalid.
   * The server also revalidates via `evaluateCouncilActivation`.
   */
  getOutboundExtras: (primary: {
    endpoint: string;
    model: string;
    agent_id?: string | null;
  }) => CouncilAgentSpec[] | null;
}

export default function useCouncilState(): UseCouncilStateResult {
  const [state, setState] = useRecoilState(councilComposerState);

  const isFull = state.extras.length >= MAX_COUNCIL_EXTRAS;

  const setEnabled = useCallback(
    (enabled: boolean) => {
      setState((prev) => ({ ...prev, enabled }));
    },
    [setState],
  );

  const setStrategy = useCallback(
    (strategy: SynthesisStrategy) => {
      setState((prev) => ({ ...prev, strategy }));
    },
    [setState],
  );

  const addExtra = useCallback(
    (extra: CouncilAgentSpec): boolean => {
      if (!extra || !extra.endpoint || !extra.model) {
        return false;
      }
      let added = false;
      setState((prev) => {
        if (prev.extras.length >= MAX_COUNCIL_EXTRAS) {
          return prev;
        }
        const fp = `${extra.endpoint}${extra.model}${extra.agent_id ?? ''}`;
        const alreadyPresent = prev.extras.some(
          (e) => `${e.endpoint}${e.model}${e.agent_id ?? ''}` === fp,
        );
        if (alreadyPresent) {
          return prev;
        }
        added = true;
        return { ...prev, extras: [...prev.extras, extra] };
      });
      return added;
    },
    [setState],
  );

  const removeExtra = useCallback(
    (index: number) => {
      setState((prev) => {
        if (index < 0 || index >= prev.extras.length) {
          return prev;
        }
        return {
          ...prev,
          extras: [...prev.extras.slice(0, index), ...prev.extras.slice(index + 1)],
        };
      });
    },
    [setState],
  );

  const reset = useCallback(() => {
    setState({
      enabled: false,
      strategy: DEFAULT_SYNTHESIS_STRATEGY,
      extras: [],
    });
  }, [setState]);

  const getOutboundExtras = useCallback(
    (primary: { endpoint: string; model: string; agent_id?: string | null }) => {
      if (!state.enabled || state.extras.length === 0) {
        return null;
      }
      const parsed = councilAgentsSchema.safeParse(state.extras);
      if (!parsed.success) {
        return null;
      }
      const composition = validateCouncilComposition({
        primary,
        extras: parsed.data,
      });
      if (composition) {
        return null;
      }
      return parsed.data;
    },
    [state],
  );

  return useMemo(
    () => ({
      state,
      isFull,
      setEnabled,
      setStrategy,
      addExtra,
      removeExtra,
      reset,
      getOutboundExtras,
    }),
    [state, isFull, setEnabled, setStrategy, addExtra, removeExtra, reset, getOutboundExtras],
  );
}
