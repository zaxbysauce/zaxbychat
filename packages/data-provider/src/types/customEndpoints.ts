/**
 * Phase 9 — DB-backed UI-managed custom endpoint types.
 *
 * The `config` field on a DB-backed entry mirrors the YAML
 * `endpoints.custom[*]` shape (`TEndpoint`) exactly so that records
 * round-trip cleanly to/from YAML if an admin prefers admin-as-code.
 * Capability declarations are surfaced as a sibling field on the
 * record so Phase 2's pre-Run gate continues to work for DB endpoints.
 *
 * `apiKey` may be the literal sentinel `"user_provided"` — when set,
 * each user supplies their own key via the existing per-user key
 * dialog (`SetKeyDialog`), keyed by endpoint name.
 */

import { z } from 'zod';
import { endpointSchema } from '../config';

/** Tags consumed by Phase 2's capability-aware UI + pre-Run gate. */
export const customEndpointCapabilities = [
  'vision',
  'tools',
  'structured_output',
  'web_search',
  'file_search',
  'actions',
  'execute_code',
] as const;

export type CustomEndpointCapability = (typeof customEndpointCapabilities)[number];

export const customEndpointCapabilitySchema = z.enum(customEndpointCapabilities);

/**
 * Body of POST/PATCH for create/update. Mirrors `TEndpoint` (Phase 1
 * Zod schema) plus `capabilities`. The `name` field is required at
 * create-time and used as the unique identifier (matching how
 * per-user keys are stored — `SetKeyDialog` keys by endpoint name).
 */
export const customEndpointConfigSchema = endpointSchema.extend({
  capabilities: z.array(customEndpointCapabilitySchema).optional(),
});

export type TCustomEndpointConfig = z.infer<typeof customEndpointConfigSchema>;

export const customEndpointCreateParamsSchema = z.object({
  config: customEndpointConfigSchema,
});

export type TCustomEndpointCreateParams = z.infer<typeof customEndpointCreateParamsSchema>;

export const customEndpointUpdateParamsSchema = z.object({
  config: customEndpointConfigSchema.partial(),
});

export type TCustomEndpointUpdateParams = z.infer<typeof customEndpointUpdateParamsSchema>;

/**
 * Persisted DB document shape returned to the frontend. `_id` is the
 * Mongo ObjectId; `author` is the user that created the entry;
 * `tenantId` scopes records per deployment when multi-tenant. The
 * `source: 'db'` discriminator distinguishes these records from
 * YAML-loaded entries when both flow through the merged registry.
 */
export interface ICustomEndpointDB {
  _id?: string;
  name: string;
  config: TCustomEndpointConfig;
  author?: string | null;
  tenantId?: string | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export type TCustomEndpointResponse = ICustomEndpointDB & {
  source: 'db';
};

export type TCustomEndpointsListResponse = TCustomEndpointResponse[];

/**
 * Test-connection request shape. The probe issues a `/v1/models` GET
 * (or a configurable healthcheck endpoint) under the same URL gate
 * the runtime uses. Returns success / failure with a short reason.
 *
 * The Test Connection schema is a relaxed sibling of the create/update
 * schema (review M10): it does NOT require `models.default` to be
 * non-empty, because users routinely test a baseURL before they know
 * which models the upstream serves. The dialog never persists a
 * record that fails the strict schema; the relaxed shape is only used
 * for the probe path.
 */
export const testCustomEndpointConfigSchema = endpointSchema
  .omit({ models: true })
  .extend({
    models: z
      .object({
        default: z.array(z.string()).optional(),
        fetch: z.boolean().optional(),
        userIdQuery: z.boolean().optional(),
      })
      .optional(),
    capabilities: z.array(customEndpointCapabilitySchema).optional(),
  });

export type TTestCustomEndpointConfig = z.infer<typeof testCustomEndpointConfigSchema>;

export const testCustomEndpointParamsSchema = z.object({
  config: testCustomEndpointConfigSchema,
});

export type TTestCustomEndpointParams = z.infer<typeof testCustomEndpointParamsSchema>;

export type TTestCustomEndpointResponse =
  | { ok: true; durationMs: number; modelsDetected?: number }
  | { ok: false; reason: string; status?: number; durationMs: number };
