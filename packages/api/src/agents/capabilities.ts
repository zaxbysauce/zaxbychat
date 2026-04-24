import { resolveCapabilities, ErrorTypes } from 'librechat-data-provider';
import type { Response } from 'express';
import type { CapabilityResolution, CapabilitySource } from 'librechat-data-provider';
import type { IMongoFile, AppConfig } from '@librechat/data-schemas';

export type CapabilityKey = 'vision' | 'toolCalling' | 'structuredOutput' | 'files';

/**
 * Structured payload for a non-fatal capability notice emitted as a custom SSE
 * event (`capability_notice`). Narrowly scoped to enforcement outcomes — not a
 * generic metadata channel.
 */
export interface CapabilityNotice {
  capability: CapabilityKey;
  severity: 'info' | 'warning';
  source: CapabilitySource;
  action:
    | 'dropped_tools'
    | 'stripped_structured_output'
    | 'unverified_capability'
    | 'soft_blocked';
  message: string;
  pattern?: string;
}

/**
 * Minimum agent-ish surface the enforcement function inspects and (for
 * drop/strip outcomes) mutates in place. Kept structural rather than tied to
 * RunAgent so the enforcement module stays independent of run.ts internals.
 */
export interface EnforceableAgent {
  provider: string;
  model: string;
  /** Tool names (pre-resolution) or loaded tool instances — enforcement treats both opaquely. */
  tools?: unknown[];
  model_parameters?: Record<string, unknown>;
  attachments?: IMongoFile[];
}

export interface EnforcementResult {
  notices: CapabilityNotice[];
}

export interface EnforcementError {
  errorType:
    | ErrorTypes.VISION_NOT_SUPPORTED
    | ErrorTypes.TOOLS_NOT_SUPPORTED
    | ErrorTypes.FILES_NOT_SUPPORTED
    | ErrorTypes.STRUCTURED_OUTPUT_NOT_SUPPORTED;
  info: string;
}

export class CapabilityRejection extends Error {
  readonly errorType: EnforcementError['errorType'];
  readonly info: string;

  constructor({ errorType, info }: EnforcementError) {
    super(`{ "type": "${errorType}", "info": "${info}" }`);
    this.name = 'CapabilityRejection';
    this.errorType = errorType;
    this.info = info;
  }
}

/** Reads the strict-mode env flag at call time so tests can override it. */
export function isStrictMode(): boolean {
  return process.env.ENFORCE_MODEL_CAPABILITIES === 'strict';
}

/**
 * Resolves per-agent capabilities via the shared data-provider resolver.
 * Delegation-only: all resolution rules live in data-provider.
 */
export function resolveAgentCapabilities(
  provider: string,
  model: string,
  appConfig?: AppConfig,
): CapabilityResolution {
  return resolveCapabilities(provider, model, appConfig?.modelSpecs?.list);
}

function hasImageAttachment(attachments?: IMongoFile[]): boolean {
  if (!attachments || attachments.length === 0) {
    return false;
  }
  for (const file of attachments) {
    const type = (file as unknown as { type?: string }).type;
    if (typeof type === 'string' && type.startsWith('image')) {
      return true;
    }
  }
  return false;
}

function hasNonImageAttachment(attachments?: IMongoFile[]): boolean {
  if (!attachments || attachments.length === 0) {
    return false;
  }
  for (const file of attachments) {
    const type = (file as unknown as { type?: string }).type;
    if (typeof type !== 'string' || !type.startsWith('image')) {
      return true;
    }
  }
  return false;
}

function hasStructuredOutputRequest(modelParameters?: Record<string, unknown>): boolean {
  if (!modelParameters) {
    return false;
  }
  const responseFormat = modelParameters.response_format;
  if (responseFormat == null) {
    return false;
  }
  if (typeof responseFormat === 'string') {
    return responseFormat !== 'text';
  }
  return true;
}

function sourceDescriptor(resolution: CapabilityResolution): string {
  if (resolution.source === 'inferred') {
    return ` (inferred from ${resolution.matchedPattern})`;
  }
  if (resolution.source === 'unknown') {
    return ' (capability unverified)';
  }
  return '';
}

/**
 * Evaluates each in-scope capability under the plan's policy matrix:
 *
 *   explicit false + condition present →
 *     - vision/files: reject
 *     - toolCalling: drop tools + warn
 *     - structuredOutput: strip response_format + warn
 *
 *   inferred false + condition present →
 *     - vision/files: warn-and-permit (never hard-block by default)
 *     - toolCalling: drop tools + warn
 *     - structuredOutput: strip + warn
 *
 *   unknown + condition present →
 *     - emit an `unverified_capability` notice so the UI can surface the state
 *
 * Strict mode upgrades:
 *     - explicit false remains authoritative (same as default).
 *     - unknown + vision-with-image OR unknown + files-with-nonimage → reject.
 *       (These are the two cases where proceeding would be dishonest.)
 *     - inferred false is NEVER auto-upgraded to reject by strict mode; the
 *       trust hierarchy (explicit > inferred > unknown) stays intact.
 *
 * Mutates `agent` in place for drop/strip outcomes. Throws `CapabilityRejection`
 * for reject outcomes. Returns collected notices for the caller to emit.
 */
export function enforceAgentCapabilities(params: {
  agent: EnforceableAgent;
  resolution: CapabilityResolution;
  strictMode?: boolean;
}): EnforcementResult {
  const { agent, resolution } = params;
  const strictMode = params.strictMode ?? isStrictMode();
  const notices: CapabilityNotice[] = [];

  const imagePresent = hasImageAttachment(agent.attachments);
  const nonImagePresent = hasNonImageAttachment(agent.attachments);
  const toolsPresent = !!agent.tools && agent.tools.length > 0;
  const structuredPresent = hasStructuredOutputRequest(agent.model_parameters);

  enforceVision({
    resolution,
    imagePresent,
    agent,
    notices,
    strictMode,
  });
  enforceFiles({
    resolution,
    nonImagePresent,
    agent,
    notices,
    strictMode,
  });
  enforceToolCalling({
    resolution,
    toolsPresent,
    agent,
    notices,
  });
  enforceStructuredOutput({
    resolution,
    structuredPresent,
    agent,
    notices,
  });

  return { notices };
}

function enforceVision(params: {
  resolution: CapabilityResolution;
  imagePresent: boolean;
  agent: EnforceableAgent;
  notices: CapabilityNotice[];
  strictMode: boolean;
}): void {
  const { resolution, imagePresent, agent, notices, strictMode } = params;
  if (!imagePresent) {
    return;
  }
  if (resolution.source === 'explicit' && !resolution.capabilities.vision) {
    throw new CapabilityRejection({
      errorType: ErrorTypes.VISION_NOT_SUPPORTED,
      info: agent.model,
    });
  }
  if (resolution.source === 'inferred' && !resolution.capabilities.vision) {
    notices.push({
      capability: 'vision',
      severity: 'warning',
      source: 'inferred',
      action: 'soft_blocked',
      message: `Model ${agent.model} likely does not support image input${sourceDescriptor(resolution)}. Proceeding may produce degraded results.`,
      pattern: resolution.matchedPattern,
    });
    return;
  }
  if (resolution.source === 'unknown') {
    if (strictMode) {
      throw new CapabilityRejection({
        errorType: ErrorTypes.VISION_NOT_SUPPORTED,
        info: agent.model,
      });
    }
    notices.push({
      capability: 'vision',
      severity: 'info',
      source: 'unknown',
      action: 'unverified_capability',
      message: `Vision capability is not verified for ${agent.model}. Image handling may be unreliable.`,
    });
  }
}

function enforceFiles(params: {
  resolution: CapabilityResolution;
  nonImagePresent: boolean;
  agent: EnforceableAgent;
  notices: CapabilityNotice[];
  strictMode: boolean;
}): void {
  const { resolution, nonImagePresent, agent, notices, strictMode } = params;
  if (!nonImagePresent) {
    return;
  }
  if (resolution.source === 'explicit' && !resolution.capabilities.files) {
    throw new CapabilityRejection({
      errorType: ErrorTypes.FILES_NOT_SUPPORTED,
      info: agent.model,
    });
  }
  if (resolution.source === 'inferred' && !resolution.capabilities.files) {
    notices.push({
      capability: 'files',
      severity: 'warning',
      source: 'inferred',
      action: 'soft_blocked',
      message: `Model ${agent.model} may not support file attachments${sourceDescriptor(resolution)}.`,
      pattern: resolution.matchedPattern,
    });
    return;
  }
  if (resolution.source === 'unknown') {
    if (strictMode) {
      throw new CapabilityRejection({
        errorType: ErrorTypes.FILES_NOT_SUPPORTED,
        info: agent.model,
      });
    }
    notices.push({
      capability: 'files',
      severity: 'info',
      source: 'unknown',
      action: 'unverified_capability',
      message: `File capability is not verified for ${agent.model}.`,
    });
  }
}

function enforceToolCalling(params: {
  resolution: CapabilityResolution;
  toolsPresent: boolean;
  agent: EnforceableAgent;
  notices: CapabilityNotice[];
}): void {
  const { resolution, toolsPresent, agent, notices } = params;
  if (!toolsPresent) {
    return;
  }
  if (resolution.source === 'explicit' && !resolution.capabilities.toolCalling) {
    agent.tools = [];
    notices.push({
      capability: 'toolCalling',
      severity: 'warning',
      source: 'explicit',
      action: 'dropped_tools',
      message: `Tools were dropped for ${agent.model} because the model's configured capabilities do not include tool calling.`,
    });
    return;
  }
  if (resolution.source === 'inferred' && !resolution.capabilities.toolCalling) {
    agent.tools = [];
    notices.push({
      capability: 'toolCalling',
      severity: 'warning',
      source: 'inferred',
      action: 'dropped_tools',
      message: `Tools were dropped for ${agent.model}${sourceDescriptor(resolution)}; tool calling is not supported by this model family.`,
      pattern: resolution.matchedPattern,
    });
  }
}

function enforceStructuredOutput(params: {
  resolution: CapabilityResolution;
  structuredPresent: boolean;
  agent: EnforceableAgent;
  notices: CapabilityNotice[];
}): void {
  const { resolution, structuredPresent, agent, notices } = params;
  if (!structuredPresent || !agent.model_parameters) {
    return;
  }
  if (resolution.source === 'explicit' && !resolution.capabilities.structuredOutput) {
    delete agent.model_parameters.response_format;
    notices.push({
      capability: 'structuredOutput',
      severity: 'warning',
      source: 'explicit',
      action: 'stripped_structured_output',
      message: `Structured output (response_format) was removed for ${agent.model}; the model's configured capabilities do not include structured output.`,
    });
    return;
  }
  if (resolution.source === 'inferred' && !resolution.capabilities.structuredOutput) {
    delete agent.model_parameters.response_format;
    notices.push({
      capability: 'structuredOutput',
      severity: 'warning',
      source: 'inferred',
      action: 'stripped_structured_output',
      message: `Structured output (response_format) was removed for ${agent.model}${sourceDescriptor(resolution)}.`,
      pattern: resolution.matchedPattern,
    });
  }
}

/**
 * Writes a capability notice to the SSE response stream as a custom event
 * (`event: capability_notice`). Client-side hook listens for this event name
 * and renders a separate UI notice tied to the response.
 *
 * This is additive — the existing event types (`attachment`, `message`,
 * `error`) are unchanged. `@librechat/agents` is not touched.
 */
export function emitCapabilityNotice(res: Response, notice: CapabilityNotice): void {
  if (!res || typeof res.write !== 'function' || res.writableEnded) {
    return;
  }
  res.write(`event: capability_notice\ndata: ${JSON.stringify(notice)}\n\n`);
}
