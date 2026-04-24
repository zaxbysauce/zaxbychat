import { z } from 'zod';
import type { TModelSpecPreset } from './schemas';
import {
  EModelEndpoint,
  tModelSpecPresetSchema,
  eModelEndpointSchema,
  AuthType,
  authTypeSchema,
} from './schemas';

/** Per-model inference capabilities, consolidated on TModelSpec. */
export type ModelCapabilities = {
  chat: boolean;
  vision: boolean;
  files: boolean;
  toolCalling: boolean;
  structuredOutput: boolean;
  streaming: boolean;
  embeddings: boolean;
  rerank: boolean;
  reasoning: boolean;
};

export const modelCapabilitiesSchema = z.object({
  chat: z.boolean(),
  vision: z.boolean(),
  files: z.boolean(),
  toolCalling: z.boolean(),
  structuredOutput: z.boolean(),
  streaming: z.boolean(),
  embeddings: z.boolean(),
  rerank: z.boolean(),
  reasoning: z.boolean(),
});

export type TModelSpec = {
  name: string;
  label: string;
  preset: TModelSpecPreset;
  order?: number;
  default?: boolean;
  description?: string;
  /**
   * Optional group name for organizing specs in the UI selector.
   * - If it matches an endpoint name (e.g., "openAI", "groq"), the spec appears nested under that endpoint
   * - If it's a custom name (doesn't match any endpoint), it creates a separate collapsible group
   * - If omitted, the spec appears as a standalone item at the top level
   */
  group?: string;
  /**
   * Optional icon URL for the group this spec belongs to.
   * Only needs to be set on one spec per group - the first one found with a groupIcon will be used.
   * Can be a URL or an endpoint name to use its icon.
   */
  groupIcon?: string | EModelEndpoint;
  showIconInMenu?: boolean;
  showIconInHeader?: boolean;
  iconURL?: string | EModelEndpoint;
  authType?: AuthType;
  webSearch?: boolean;
  fileSearch?: boolean;
  executeCode?: boolean;
  artifacts?: string | boolean;
  mcpServers?: string[];
  /** Formal per-model capability flags. Absent fields are inferred conservatively. */
  capabilities?: ModelCapabilities;
};

export const tModelSpecSchema = z.object({
  name: z.string(),
  label: z.string(),
  preset: tModelSpecPresetSchema,
  order: z.number().optional(),
  default: z.boolean().optional(),
  description: z.string().optional(),
  group: z.string().optional(),
  groupIcon: z.union([z.string(), eModelEndpointSchema]).optional(),
  showIconInMenu: z.boolean().optional(),
  showIconInHeader: z.boolean().optional(),
  iconURL: z.union([z.string(), eModelEndpointSchema]).optional(),
  authType: authTypeSchema.optional(),
  webSearch: z.boolean().optional(),
  fileSearch: z.boolean().optional(),
  executeCode: z.boolean().optional(),
  artifacts: z.union([z.string(), z.boolean()]).optional(),
  mcpServers: z.array(z.string()).optional(),
  capabilities: modelCapabilitiesSchema.optional(),
});

export const specsConfigSchema = z.object({
  enforce: z.boolean().default(false),
  prioritize: z.boolean().default(true),
  list: z.array(tModelSpecSchema).min(1),
  addedEndpoints: z.array(z.union([z.string(), eModelEndpointSchema])).optional(),
});

export type TSpecsConfig = z.infer<typeof specsConfigSchema>;
