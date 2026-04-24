import React from 'react';
import { useRecoilValue } from 'recoil';
import { Sparkles, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { synthesisLiveStateFamily } from '~/store/council';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

interface SynthesisCardProps {
  conversationId: string;
  className?: string;
}

/**
 * Renders the Phase 4 council synthesis output as its own card, separate
 * from assistant content. Never hides which content came from legs vs
 * synthesis (§D2).
 *
 * Three visible states:
 *   - streaming: emitted text grows as SSE synthesis_delta events arrive
 *   - complete:  final synthesized answer plus per-leg status badges
 *   - skipped_all_failed: honest "all legs failed — no synthesis generated"
 *
 * Returns null when no council run is active for this conversation, so
 * non-council turns render identically to pre-Phase-4.
 */
export default function SynthesisCard({ conversationId, className }: SynthesisCardProps) {
  const localize = useLocalize();
  const state = useRecoilValue(synthesisLiveStateFamily(conversationId));

  if (!state) {
    return null;
  }

  if (state.status === 'skipped_all_failed') {
    return (
      <div
        className={cn(
          'mt-3 rounded-lg border border-amber-600/30 bg-amber-950/10 p-4 text-sm',
          className,
        )}
        aria-label={localize('com_ui_synthesis_skipped_title')}
      >
        <div className="flex items-center gap-2 text-amber-500">
          <XCircle className="size-4" aria-hidden="true" />
          <span className="font-semibold">{localize('com_ui_synthesis_skipped_title')}</span>
        </div>
        <p className="mt-2 text-text-secondary">
          {localize('com_ui_synthesis_skipped_body')}
        </p>
        <LegStatusList legStatus={state.legStatus} />
      </div>
    );
  }

  const isComplete = state.status === 'complete';
  const successCount = state.legStatus.filter((l) => l.status === 'succeeded').length;
  const totalCount = state.legStatus.length;

  return (
    <div
      className={cn(
        'mt-3 rounded-lg border border-border-light bg-surface-secondary p-4 text-sm',
        className,
      )}
      aria-label={localize('com_ui_synthesis_title')}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-amber-500" aria-hidden="true" />
          <span className="font-semibold">{localize('com_ui_synthesis_title')}</span>
          <span className="text-xs text-text-tertiary">
            · {formatStrategy(state.strategy, localize)}
          </span>
        </div>
        {isComplete && <CheckCircle2 className="size-4 text-surface-submit" aria-hidden="true" />}
        {!isComplete && (
          <span className="text-xs italic text-text-tertiary">
            {localize('com_ui_synthesis_streaming')}
          </span>
        )}
      </div>

      {state.partial && (
        <div className="mt-2 flex items-center gap-2 text-amber-500">
          <AlertTriangle className="size-3.5" aria-hidden="true" />
          <span className="text-xs">
            {localize('com_ui_synthesis_partial', { 0: successCount, 1: totalCount })}
          </span>
        </div>
      )}

      <div className="mt-3 whitespace-pre-wrap">{state.text || ''}</div>

      <LegStatusList legStatus={state.legStatus} />
    </div>
  );
}

interface LegStatusListProps {
  legStatus: ReadonlyArray<{
    legId: string;
    agentId: string;
    model?: string;
    status: 'succeeded' | 'failed' | 'unknown';
    error?: string;
  }>;
}

function LegStatusList({ legStatus }: LegStatusListProps) {
  if (legStatus.length === 0) {
    return null;
  }
  return (
    <ul className="mt-3 space-y-1 border-t border-border-light pt-2 text-xs">
      {legStatus.map((leg) => (
        <li key={leg.legId} className="flex items-center gap-2">
          {leg.status === 'succeeded' ? (
            <CheckCircle2 className="size-3 text-surface-submit" aria-hidden="true" />
          ) : leg.status === 'failed' ? (
            <XCircle className="size-3 text-red-500" aria-hidden="true" />
          ) : (
            <span className="size-3 rounded-full bg-text-tertiary" aria-hidden="true" />
          )}
          <span className="text-text-secondary">
            {leg.model ?? leg.agentId}
            {leg.status === 'failed' && leg.error ? ` — ${leg.error}` : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}

function formatStrategy(
  strategy: 'primary_critic' | 'best_of_three' | 'compare_and_synthesize',
  localize: ReturnType<typeof useLocalize>,
): string {
  if (strategy === 'primary_critic') {
    return localize('com_ui_council_strategy_critic');
  }
  if (strategy === 'best_of_three') {
    return localize('com_ui_council_strategy_best_of_three');
  }
  return localize('com_ui_council_strategy_compare');
}
