import React, { useMemo } from 'react';
import { MAX_COUNCIL_EXTRAS } from 'librechat-data-provider';
import type { CouncilAgentSpec, SynthesisStrategy } from 'librechat-data-provider';
import { useGetStartupConfig, useGetEndpointsQuery } from '~/data-provider';
import { useChatContext } from '~/Providers';
import useCouncilState from '~/hooks/Council/useCouncilState';
import { useGetModelsQuery } from 'librechat-data-provider/react-query';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

interface ModelChoice {
  endpoint: string;
  model: string;
  label: string;
}

/**
 * Phase 4 council composer controls. Rendered only when
 * `interfaceConfig.council === true`. When the toggle is off, no council
 * payload is sent; the existing chat behavior (including addedConvo) is
 * unchanged. When the toggle is on and ≥1 extra is picked, the outgoing
 * payload gains `councilAgents` + `councilStrategy` which the server
 * converts into a two-phase council run.
 *
 * Deliberately minimal — this is the honest-activation surface, not a
 * stylized production UI. Richer surfaces can build on this contract.
 */
export default function CouncilControls() {
  const localize = useLocalize();
  const { data: startupConfig } = useGetStartupConfig();
  const { data: endpointsConfig } = useGetEndpointsQuery();
  const { data: modelsByEndpoint } = useGetModelsQuery();
  const { conversation } = useChatContext();
  const council = useCouncilState();

  const council_flag = startupConfig?.interface?.council === true;

  const primary = useMemo(
    () => ({
      endpoint: conversation?.endpointType ?? conversation?.endpoint ?? '',
      model: conversation?.model ?? '',
    }),
    [conversation?.endpoint, conversation?.endpointType, conversation?.model],
  );

  const availableChoices = useMemo<ModelChoice[]>(() => {
    if (!modelsByEndpoint || !endpointsConfig) {
      return [];
    }
    const choices: ModelChoice[] = [];
    for (const endpoint of Object.keys(modelsByEndpoint)) {
      const models = modelsByEndpoint[endpoint] ?? [];
      for (const model of models) {
        if (endpoint === primary.endpoint && model === primary.model) {
          continue;
        }
        const alreadyPicked = council.state.extras.some(
          (e) => e.endpoint === endpoint && e.model === model,
        );
        if (alreadyPicked) {
          continue;
        }
        choices.push({ endpoint, model, label: `${endpoint} · ${model}` });
      }
    }
    return choices;
  }, [modelsByEndpoint, endpointsConfig, primary, council.state.extras]);

  if (!council_flag) {
    return null;
  }

  const strategies: Array<{ value: SynthesisStrategy; label: string }> = [
    {
      value: 'compare_and_synthesize',
      label: localize('com_ui_council_strategy_compare'),
    },
    { value: 'primary_critic', label: localize('com_ui_council_strategy_critic') },
    { value: 'best_of_three', label: localize('com_ui_council_strategy_best_of_three') },
  ];

  const handleAdd = (choice: ModelChoice) => {
    const extra: CouncilAgentSpec = { endpoint: choice.endpoint, model: choice.model };
    council.addExtra(extra);
  };

  return (
    <div
      className={cn(
        'mx-2 my-2 rounded-lg border border-border-light bg-surface-secondary p-3 text-sm',
      )}
      aria-label={localize('com_ui_council_controls')}
    >
      <div className="flex items-center justify-between">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={council.state.enabled}
            onChange={(e) => council.setEnabled(e.target.checked)}
            aria-label={localize('com_ui_council_enable')}
          />
          <span className="font-medium">{localize('com_ui_council_enable')}</span>
        </label>
        {council.state.enabled && (
          <button
            type="button"
            onClick={council.reset}
            className="text-xs text-text-secondary underline"
          >
            {localize('com_ui_council_reset')}
          </button>
        )}
      </div>

      {council.state.enabled && (
        <div className="mt-3 space-y-3">
          <div>
            <label className="block text-xs font-medium text-text-secondary">
              {localize('com_ui_council_strategy_label')}
            </label>
            <select
              value={council.state.strategy}
              onChange={(e) =>
                council.setStrategy(e.target.value as SynthesisStrategy)
              }
              className="mt-1 w-full rounded border border-border-light bg-surface-primary px-2 py-1"
              aria-label={localize('com_ui_council_strategy_label')}
            >
              {strategies.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-xs font-medium text-text-secondary">
                {localize('com_ui_council_extras_label', {
                  0: council.state.extras.length,
                  1: MAX_COUNCIL_EXTRAS,
                })}
              </label>
            </div>
            {council.state.extras.length === 0 && (
              <p className="text-xs text-text-tertiary">
                {localize('com_ui_council_extras_empty')}
              </p>
            )}
            <ul className="space-y-1">
              {council.state.extras.map((extra, i) => (
                <li
                  key={`${extra.endpoint}-${extra.model}-${i}`}
                  className="flex items-center justify-between rounded bg-surface-primary px-2 py-1"
                >
                  <span>
                    {extra.endpoint} · {extra.model}
                  </span>
                  <button
                    type="button"
                    onClick={() => council.removeExtra(i)}
                    className="text-xs text-text-secondary underline"
                    aria-label={localize('com_ui_council_remove_extra', { 0: extra.model })}
                  >
                    {localize('com_ui_remove')}
                  </button>
                </li>
              ))}
            </ul>

            {!council.isFull && (
              <div className="mt-2">
                <label className="block text-xs font-medium text-text-secondary">
                  {localize('com_ui_council_add_extra')}
                </label>
                <select
                  value=""
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) return;
                    const [endpoint, model] = v.split('||');
                    const choice = availableChoices.find(
                      (c) => c.endpoint === endpoint && c.model === model,
                    );
                    if (choice) {
                      handleAdd(choice);
                    }
                  }}
                  className="mt-1 w-full rounded border border-border-light bg-surface-primary px-2 py-1"
                  aria-label={localize('com_ui_council_add_extra')}
                >
                  <option value="">{localize('com_ui_council_select_model')}</option>
                  {availableChoices.map((c) => (
                    <option key={`${c.endpoint}||${c.model}`} value={`${c.endpoint}||${c.model}`}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
