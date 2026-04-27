import { memo, useEffect, useState } from 'react';
import {
  Label,
  Input,
  Button,
  Spinner,
  OGDialog,
  OGDialogTitle,
  OGDialogHeader,
  OGDialogFooter,
  OGDialogContent,
} from '@librechat/client';
import {
  customEndpointConfigSchema,
  customEndpointCapabilities,
} from 'librechat-data-provider';
import type {
  TCustomEndpointConfig,
  TCustomEndpointResponse,
  CustomEndpointCapability,
} from 'librechat-data-provider';
import {
  useCreateCustomEndpointMutation,
  useUpdateCustomEndpointMutation,
  useTestCustomEndpointMutation,
} from '~/data-provider/CustomEndpoints';
import { useLocalize } from '~/hooks';

const USER_PROVIDED = 'user_provided';

interface Props {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /** Existing record for edit mode; undefined creates a new endpoint. */
  existing?: TCustomEndpointResponse;
}

interface FormState {
  name: string;
  baseURL: string;
  apiKeyMode: 'literal' | 'user_provided';
  apiKeyValue: string;
  modelsCsv: string;
  iconURL: string;
  modelDisplayLabel: string;
  capabilities: Set<CustomEndpointCapability>;
}

function emptyState(): FormState {
  return {
    name: '',
    baseURL: '',
    apiKeyMode: 'literal',
    apiKeyValue: '',
    modelsCsv: '',
    iconURL: '',
    modelDisplayLabel: '',
    capabilities: new Set(),
  };
}

function fromExisting(record: TCustomEndpointResponse): FormState {
  const cfg = record.config;
  const apiKey = cfg.apiKey ?? '';
  return {
    name: cfg.name,
    baseURL: cfg.baseURL,
    apiKeyMode: apiKey === USER_PROVIDED ? 'user_provided' : 'literal',
    apiKeyValue: apiKey === USER_PROVIDED ? '' : apiKey,
    modelsCsv: (cfg.models?.default ?? []).join(', '),
    iconURL: cfg.iconURL ?? '',
    modelDisplayLabel: cfg.modelDisplayLabel ?? '',
    capabilities: new Set(cfg.capabilities ?? []),
  };
}

function buildConfig(state: FormState): TCustomEndpointConfig {
  const apiKey = state.apiKeyMode === 'user_provided' ? USER_PROVIDED : state.apiKeyValue;
  const defaults = state.modelsCsv
    .split(',')
    .map((m) => m.trim())
    .filter((m) => m.length > 0);
  return {
    name: state.name.trim(),
    apiKey,
    baseURL: state.baseURL.trim(),
    models: { default: defaults.length > 0 ? defaults : ['default'] },
    ...(state.iconURL ? { iconURL: state.iconURL } : {}),
    ...(state.modelDisplayLabel ? { modelDisplayLabel: state.modelDisplayLabel } : {}),
    ...(state.capabilities.size > 0
      ? { capabilities: Array.from(state.capabilities) }
      : {}),
  } as TCustomEndpointConfig;
}

function CustomEndpointDialogContent({ open, onOpenChange, existing }: Props) {
  const localize = useLocalize();
  const isEdit = !!existing;
  const [state, setState] = useState<FormState>(emptyState());
  const [error, setError] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'pending' }
    | { kind: 'ok'; reason?: string }
    | { kind: 'err'; reason: string }
  >({ kind: 'idle' });

  const createMutation = useCreateCustomEndpointMutation();
  const updateMutation = useUpdateCustomEndpointMutation();
  const testMutation = useTestCustomEndpointMutation();

  useEffect(() => {
    if (open) {
      setState(existing ? fromExisting(existing) : emptyState());
      setError(null);
      setTestStatus({ kind: 'idle' });
    }
  }, [open, existing]);

  const onTest = async () => {
    setError(null);
    setTestStatus({ kind: 'pending' });
    const config = buildConfig(state);
    const parsed = customEndpointConfigSchema.safeParse(config);
    if (!parsed.success) {
      setTestStatus({
        kind: 'err',
        reason: parsed.error.issues[0]?.message ?? 'Invalid config',
      });
      return;
    }
    try {
      const result = await testMutation.mutateAsync({ config: parsed.data });
      if (result.ok) {
        setTestStatus({
          kind: 'ok',
          reason:
            typeof result.modelsDetected === 'number'
              ? `${result.modelsDetected} models detected (${result.durationMs} ms)`
              : `Reachable (${result.durationMs} ms)`,
        });
      } else {
        setTestStatus({ kind: 'err', reason: result.reason });
      }
    } catch (err) {
      setTestStatus({
        kind: 'err',
        reason: (err as Error)?.message ?? 'Probe failed',
      });
    }
  };

  const onSave = async () => {
    setError(null);
    const config = buildConfig(state);
    // Review L3: parse the URL on the client so we surface the error
    // inline instead of round-tripping to the server.
    if (config.baseURL) {
      try {
        const parsedUrl = new URL(config.baseURL);
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
          setError('Base URL must start with http:// or https://');
          return;
        }
      } catch {
        setError('Base URL is not a parseable URL');
        return;
      }
    }
    const parsed = customEndpointConfigSchema.safeParse(config);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid config');
      return;
    }
    try {
      if (isEdit && existing) {
        await updateMutation.mutateAsync({
          name: existing.name,
          params: { config: parsed.data },
        });
      } else {
        await createMutation.mutateAsync({ config: parsed.data });
      }
      onOpenChange(false);
    } catch (err) {
      const reason =
        (err as { response?: { data?: { message?: string } }; message?: string })?.response
          ?.data?.message ??
        (err as { message?: string })?.message ??
        'Save failed';
      setError(reason);
    }
  };

  const toggleCapability = (cap: CustomEndpointCapability) => {
    setState((prev) => {
      const next = new Set(prev.capabilities);
      if (next.has(cap)) next.delete(cap);
      else next.add(cap);
      return { ...prev, capabilities: next };
    });
  };

  const isSaving = createMutation.isLoading || updateMutation.isLoading;

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogContent className="w-11/12 max-w-lg" data-testid="custom-endpoint-dialog">
        <OGDialogHeader>
          <OGDialogTitle>
            {isEdit
              ? localize('com_ui_custom_endpoint_edit_title')
              : localize('com_ui_custom_endpoint_create_title')}
          </OGDialogTitle>
        </OGDialogHeader>
        <div className="flex flex-col gap-3 py-2">
          <div>
            <Label htmlFor="ce-name">{localize('com_ui_custom_endpoint_name')}</Label>
            <Input
              id="ce-name"
              placeholder="ollama-local"
              value={state.name}
              onChange={(e) => setState({ ...state, name: e.target.value })}
              disabled={isEdit}
              aria-label={localize('com_ui_custom_endpoint_name')}
            />
          </div>
          <div>
            <Label htmlFor="ce-baseurl">{localize('com_ui_custom_endpoint_base_url')}</Label>
            <Input
              id="ce-baseurl"
              placeholder="http://localhost:11434/v1"
              value={state.baseURL}
              onChange={(e) => setState({ ...state, baseURL: e.target.value })}
              aria-label={localize('com_ui_custom_endpoint_base_url')}
            />
          </div>
          <div>
            <Label>{localize('com_ui_custom_endpoint_api_key_mode')}</Label>
            <div className="flex gap-3 pt-1">
              <label className="flex items-center gap-1 text-sm">
                <input
                  type="radio"
                  name="ce-key-mode"
                  checked={state.apiKeyMode === 'literal'}
                  onChange={() => setState({ ...state, apiKeyMode: 'literal' })}
                />
                {localize('com_ui_custom_endpoint_api_key_literal')}
              </label>
              <label className="flex items-center gap-1 text-sm">
                <input
                  type="radio"
                  name="ce-key-mode"
                  checked={state.apiKeyMode === 'user_provided'}
                  onChange={() => setState({ ...state, apiKeyMode: 'user_provided' })}
                />
                {localize('com_ui_custom_endpoint_api_key_user_provided')}
              </label>
            </div>
            {state.apiKeyMode === 'literal' && (
              <Input
                className="mt-2"
                type="password"
                placeholder="sk-..."
                value={state.apiKeyValue}
                onChange={(e) => setState({ ...state, apiKeyValue: e.target.value })}
                aria-label={localize('com_ui_custom_endpoint_api_key_literal')}
              />
            )}
          </div>
          <div>
            <Label htmlFor="ce-models">{localize('com_ui_custom_endpoint_models')}</Label>
            <Input
              id="ce-models"
              placeholder="gpt-4o-mini, llama3.1:8b"
              value={state.modelsCsv}
              onChange={(e) => setState({ ...state, modelsCsv: e.target.value })}
              aria-label={localize('com_ui_custom_endpoint_models')}
            />
            <p className="mt-1 text-xs text-text-secondary">
              {localize('com_ui_custom_endpoint_models_help')}
            </p>
          </div>
          <div>
            <Label>{localize('com_ui_custom_endpoint_capabilities')}</Label>
            <div className="grid grid-cols-2 gap-1 pt-1">
              {customEndpointCapabilities.map((cap) => (
                <label key={cap} className="flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    checked={state.capabilities.has(cap)}
                    onChange={() => toggleCapability(cap)}
                  />
                  <span>{localize(`com_ui_capability_${cap}` as never) || cap}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="ce-icon">{localize('com_ui_custom_endpoint_icon_url')}</Label>
              <Input
                id="ce-icon"
                value={state.iconURL}
                onChange={(e) => setState({ ...state, iconURL: e.target.value })}
                aria-label={localize('com_ui_custom_endpoint_icon_url')}
              />
            </div>
            <div>
              <Label htmlFor="ce-display">
                {localize('com_ui_custom_endpoint_display_label')}
              </Label>
              <Input
                id="ce-display"
                value={state.modelDisplayLabel}
                onChange={(e) => setState({ ...state, modelDisplayLabel: e.target.value })}
                aria-label={localize('com_ui_custom_endpoint_display_label')}
              />
            </div>
          </div>
          {testStatus.kind === 'pending' && (
            <p className="text-sm text-text-secondary">
              <Spinner className="mr-2 inline size-3" />
              {localize('com_ui_custom_endpoint_test_pending')}
            </p>
          )}
          {testStatus.kind === 'ok' && (
            <p className="text-sm text-status-success" role="status">
              {localize('com_ui_custom_endpoint_test_ok')} — {testStatus.reason}
            </p>
          )}
          {testStatus.kind === 'err' && (
            <p className="text-sm text-status-error" role="alert">
              {localize('com_ui_custom_endpoint_test_failed')}: {testStatus.reason}
            </p>
          )}
          {error && (
            <p
              role="alert"
              className="text-sm text-status-error"
              data-testid="custom-endpoint-error"
            >
              {error}
            </p>
          )}
        </div>
        <OGDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {localize('com_ui_cancel')}
          </Button>
          <Button variant="outline" onClick={onTest} disabled={testStatus.kind === 'pending'}>
            {localize('com_ui_custom_endpoint_test_connection')}
          </Button>
          <Button onClick={onSave} disabled={isSaving}>
            {isSaving && <Spinner className="mr-2 size-3" />}
            {isEdit ? localize('com_ui_save') : localize('com_ui_create')}
          </Button>
        </OGDialogFooter>
      </OGDialogContent>
    </OGDialog>
  );
}

export default memo(CustomEndpointDialogContent);
