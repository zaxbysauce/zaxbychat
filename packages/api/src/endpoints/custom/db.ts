/**
 * Phase 9 — DB-backed custom endpoint loader.
 *
 * Resolves DB-stored custom endpoints into the same `TEndpoint[]`
 * shape the YAML loader uses, so downstream consumers
 * (`getEndpointsConfig`, `getCustomEndpointConfig`, model dropdown)
 * see DB and YAML entries uniformly without further branching.
 *
 * Merge rule (D-P9-2): YAML wins on name collision. The collision
 * check is case-insensitive (review M9) — `normalizeEndpointName`
 * only special-cases `Ollama → ollama`, so a generic case-insensitive
 * comparison is needed to catch `MyEndpoint` vs `myendpoint`.
 */

import { normalizeEndpointName } from 'librechat-data-provider';
import type {
  ICustomEndpointDB,
  TCustomEndpointConfig,
  TEndpoint,
  CustomEndpointCapability,
} from 'librechat-data-provider';

/**
 * `TEndpoint` widened with the optional `capabilities` array Phase 9
 * adds via `customEndpointConfigSchema`. Returning this preserves the
 * type information through the merge pipeline (review M4).
 */
export type TEndpointWithCapabilities = TEndpoint & {
  capabilities?: CustomEndpointCapability[];
};

/**
 * Convert a DB record's stored config into the `TEndpoint` shape used
 * by the YAML pipeline. Records that are missing required fields are
 * skipped — same posture as the YAML filter at
 * `packages/api/src/endpoints/custom/config.ts`.
 */
export function dbRecordToEndpoint(record: ICustomEndpointDB): TEndpointWithCapabilities | null {
  const config = record.config as TCustomEndpointConfig | undefined;
  if (!config) return null;
  if (!config.name || !config.apiKey || !config.baseURL || !config.models) {
    return null;
  }
  if (!config.models.fetch && (!config.models.default || config.models.default.length === 0)) {
    return null;
  }
  return config as TEndpointWithCapabilities;
}

/**
 * Build a stable case-insensitive comparison key for an endpoint
 * name. Wraps `normalizeEndpointName` so the system-canonical
 * special case (`Ollama` → `ollama`) keeps applying, and adds a
 * lowercase pass so `MyEndpoint` and `myendpoint` collide too.
 */
function nameKey(name: string): string {
  return normalizeEndpointName(name).toLowerCase();
}

/**
 * Merge YAML and DB custom-endpoint arrays. YAML wins on name
 * collision: DB entries whose case-insensitive normalised name
 * equals any YAML entry's are dropped. Order: YAML first, then any
 * non-colliding DB entries appended in the caller's iteration order.
 */
export function mergeCustomEndpointsByName(
  yamlEndpoints: ReadonlyArray<TEndpoint> | undefined,
  dbEndpoints: ReadonlyArray<TEndpoint> | undefined,
): TEndpointWithCapabilities[] {
  const yaml = (yamlEndpoints ?? []).filter(Boolean) as TEndpointWithCapabilities[];
  if (!dbEndpoints || dbEndpoints.length === 0) return [...yaml];

  const yamlNames = new Set<string>();
  for (const entry of yaml) {
    if (entry?.name) yamlNames.add(nameKey(entry.name));
  }

  const dbToAppend: TEndpointWithCapabilities[] = [];
  for (const entry of dbEndpoints) {
    if (!entry?.name) continue;
    if (yamlNames.has(nameKey(entry.name))) continue;
    dbToAppend.push(entry as TEndpointWithCapabilities);
  }
  return [...yaml, ...dbToAppend];
}

/**
 * Extract the YAML-shaped endpoint list from a sequence of DB
 * records, dropping records whose stored config is incomplete.
 */
export function dbRecordsToEndpoints(
  records: ReadonlyArray<ICustomEndpointDB>,
): TEndpointWithCapabilities[] {
  const out: TEndpointWithCapabilities[] = [];
  for (const r of records) {
    const t = dbRecordToEndpoint(r);
    if (t) out.push(t);
  }
  return out;
}
