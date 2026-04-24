import type {
  EndpointRegistryEntry,
  ValidationStatus,
} from 'librechat-data-provider';
import { endpointRegistryEntrySchema } from 'librechat-data-provider';

export interface ValidationResult {
  status: ValidationStatus;
  lastValidatedAt: string;
  error?: string;
}

export interface ProbeFn {
  (baseUrl: string, headers: Record<string, string>): Promise<{ ok: boolean; statusCode?: number }>;
}

/**
 * Validates an EndpointRegistryEntry schema and optionally probes the live endpoint.
 * Returns an updated validationStatus and lastValidatedAt timestamp.
 *
 * - Schema validation always runs first; a schema failure returns 'failed' immediately.
 * - When probe is not provided, status is set to 'unknown' (schema-only pass).
 * - When probe is provided, status is 'ok' on 2xx, 'failed' otherwise.
 */
export async function validateRegistryEntry(
  entry: EndpointRegistryEntry,
  probe?: ProbeFn,
): Promise<ValidationResult> {
  const lastValidatedAt = new Date().toISOString();

  const parseResult = endpointRegistryEntrySchema.safeParse(entry);
  if (!parseResult.success) {
    return {
      status: 'failed',
      lastValidatedAt,
      error: parseResult.error.issues.map((i) => i.message).join('; '),
    };
  }

  if (!probe) {
    return { status: 'unknown', lastValidatedAt };
  }

  const authHeaders = buildAuthHeaders(entry);
  const allHeaders = { ...authHeaders, ...(entry.headers ?? {}) };

  try {
    const result = await probe(entry.baseUrl, allHeaders);
    return {
      status: result.ok ? 'ok' : 'failed',
      lastValidatedAt,
      ...(!result.ok && result.statusCode != null
        ? { error: `HTTP ${result.statusCode}` }
        : undefined),
    };
  } catch (err) {
    return {
      status: 'failed',
      lastValidatedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function buildAuthHeaders(entry: EndpointRegistryEntry): Record<string, string> {
  const { authType, authConfig } = entry;
  if (authType === 'none') {
    return {};
  }
  if ((authType === 'api_key' || authType === 'bearer') && authConfig.keyRef) {
    const key = process.env[authConfig.keyRef] ?? '';
    const headerName = authConfig.headerName ?? 'Authorization';
    const prefix = authType === 'bearer' ? 'Bearer ' : '';
    return { [headerName]: `${prefix}${key}` };
  }
  if (authType === 'custom_header' && authConfig.headerName && authConfig.keyRef) {
    const key = process.env[authConfig.keyRef] ?? '';
    return { [authConfig.headerName]: key };
  }
  return authConfig.headers ?? {};
}
