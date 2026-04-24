import { z } from 'zod';
import { modelCapabilitiesSchema } from '../models';

export type ValidationStatus = 'unknown' | 'ok' | 'failed' | 'stale';

export const validationStatusSchema = z.enum(['unknown', 'ok', 'failed', 'stale']);

export const authConfigSchema = z.object({
  keyRef: z.string().optional(),
  headerName: z.string().optional(),
  headers: z.record(z.string()).optional(),
});

export type AuthConfig = z.infer<typeof authConfigSchema>;

export const compatibilityTypeSchema = z.enum([
  'openai',
  'google',
  'anthropic',
  'azure_openai',
  'bedrock',
  'generic_openai_compatible',
]);

export type CompatibilityType = z.infer<typeof compatibilityTypeSchema>;

export const modelRegistryEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  endpointId: z.string(),
  enabled: z.boolean(),
  capabilities: modelCapabilitiesSchema,
  contextWindow: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  notes: z.string().optional(),
});

export type ModelRegistryEntry = z.infer<typeof modelRegistryEntrySchema>;

export const endpointRegistryEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  compatibilityType: compatibilityTypeSchema,
  providerKind: z.string(),
  baseUrl: z.string().url(),
  authType: z.enum(['api_key', 'bearer', 'none', 'oauth', 'custom_header']),
  authConfig: authConfigSchema,
  enabled: z.boolean(),
  tags: z.array(z.string()),
  lastValidatedAt: z.string().datetime({ offset: true }).optional(),
  validationStatus: validationStatusSchema,
  headers: z.record(z.string()).optional(),
  addParams: z.record(z.unknown()).optional(),
  dropParams: z.array(z.string()).optional(),
  models: z.array(modelRegistryEntrySchema),
});

export type EndpointRegistryEntry = z.infer<typeof endpointRegistryEntrySchema>;
