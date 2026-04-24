import React, { useEffect, useState } from 'react';
import { Gauge } from 'lucide-react';
import type { CouncilAgentSpec, SynthesisStrategy } from 'librechat-data-provider';
import { useChatContext } from '~/Providers';
import useCouncilState from '~/hooks/Council/useCouncilState';
import { useAuthContext } from '~/hooks/AuthContext';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

interface EstimateResponse {
  approximate: boolean;
  totalEstimatedTokens: number;
  perLeg: Array<{ endpoint: string; model: string; estimatedCompletionTokens: number }>;
  synthesis: {
    endpoint: string;
    model: string;
    estimatedPromptTokens: number;
    estimatedCompletionTokens: number;
  } | null;
}

/**
 * Informational budget banner (§D7). Calls the server-authoritative
 * POST /api/agents/chat/estimate-council-budget when the council composer
 * is enabled + at least one extra is selected. Renders a small "≈ N tokens
 * estimated (approximate)" badge. Never auto-blocks submission.
 *
 * Gated on council composer state, not on the deployment flag — if the
 * deployment flag is off, CouncilControls doesn't render, so this banner
 * never mounts with a reachable primary context.
 */
export default function CouncilBudgetBanner() {
  const localize = useLocalize();
  const { token } = useAuthContext();
  const { conversation } = useChatContext();
  const council = useCouncilState();

  const primary = {
    endpoint: conversation?.endpointType ?? conversation?.endpoint ?? '',
    model: conversation?.model ?? '',
  };

  const [estimate, setEstimate] = useState<EstimateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const shouldQuery =
    council.state.enabled &&
    council.state.extras.length > 0 &&
    primary.endpoint.length > 0 &&
    primary.model.length > 0;

  useEffect(() => {
    if (!shouldQuery) {
      setEstimate(null);
      setError(null);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const body: {
      primary: { endpoint: string; model: string };
      extras: CouncilAgentSpec[];
      strategy: SynthesisStrategy;
    } = {
      primary,
      extras: council.state.extras,
      strategy: council.state.strategy,
    };

    fetch('/api/agents/chat/estimate-council-budget', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token ? `Bearer ${token}` : '',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return (await res.json()) as EstimateResponse;
      })
      .then((data) => {
        if (cancelled) {
          return;
        }
        setEstimate(data);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled || (err as { name?: string })?.name === 'AbortError') {
          return;
        }
        setEstimate(null);
        setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    shouldQuery,
    token,
    primary.endpoint,
    primary.model,
    council.state.extras,
    council.state.strategy,
  ]);

  if (!shouldQuery || !estimate) {
    return null;
  }

  const total = estimate.totalEstimatedTokens;
  const legCount = council.state.extras.length + 1;

  return (
    <div
      className={cn(
        'mx-2 flex items-center gap-2 rounded-md bg-surface-tertiary px-3 py-1.5 text-xs text-text-secondary',
      )}
      role="status"
      aria-live="polite"
    >
      <Gauge className="size-3.5" aria-hidden="true" />
      <span>
        {localize('com_ui_council_budget_banner', {
          0: total.toLocaleString(),
          1: legCount,
        })}
      </span>
      <span className="italic text-text-tertiary">
        ({localize('com_ui_council_budget_approximate')})
      </span>
      {error && <span className="ml-auto text-red-500">{error}</span>}
    </div>
  );
}
