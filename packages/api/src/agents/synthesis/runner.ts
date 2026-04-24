import { logger } from '@librechat/data-schemas';
import { HumanMessage } from '@langchain/core/messages';
import { Run, GraphEvents } from '@librechat/agents';
import { SYNTHESIS_AGENT_ID } from 'librechat-data-provider';
import type { Response } from 'express';
import type { EventHandler, LLMConfig } from '@librechat/agents';
import type { SynthesisState, UsageMetadata } from '../../stream/interfaces/IJobStore';
import type { SynthesisPromptResult } from './templates';
import {
  emitSynthesisStart,
  emitSynthesisDelta,
  emitSynthesisComplete,
  emitSynthesisSkippedAllFailed,
} from './orchestrator';

export interface SynthesisRunParams {
  res: Response;
  runId: string;
  streamId: string;
  abortSignal: AbortSignal;
  llmConfig: LLMConfig;
  prompt: SynthesisPromptResult;
  collectedUsage: UsageMetadata[];
  setSynthesisState: (partial: Partial<SynthesisState>) => Promise<void>;
}

export interface SynthesisRunResult {
  emittedText: string;
  completed: boolean;
  aborted: boolean;
  error?: string;
}

/**
 * Runs phase-2 synthesis as a standard single-agent Run.create (mirrors the
 * `packages/api/src/agents/memory.ts` pattern). Streams each content delta
 * as a `synthesis_delta` SSE event on the parent request's response. Tags
 * every usage entry emitted by the underlying model with
 * `agentId: '__synthesis__'` so billing produces a distinct row.
 *
 * Phase 2 is invoked only after phase-1 legs have completed AND
 * `shouldRunSynthesis` returned `{run: true}` (caller responsibility).
 * If `shouldRunSynthesis` returned `all_legs_failed`, the caller emits the
 * `synthesis_skipped_all_failed` event directly without calling this runner.
 *
 * The runner updates SynthesisState at each lifecycle transition so three-
 * state resume (pre/mid/post synthesis) has enough information to replay
 * deterministically across Redis replicas.
 */
export async function runCouncilSynthesis(
  params: SynthesisRunParams,
): Promise<SynthesisRunResult> {
  const {
    res,
    runId,
    abortSignal,
    llmConfig,
    prompt,
    collectedUsage,
    setSynthesisState,
  } = params;

  let emittedText = '';
  let aborted = false;
  let errorMessage: string | undefined;

  emitSynthesisStart(res, {
    strategy: prompt.strategy,
    legStatus: prompt.legStatus,
    partial: prompt.partial,
  });
  await setSynthesisState({
    strategy: prompt.strategy,
    started: true,
    completed: false,
    emittedIndex: 0,
    text: '',
    legStatus: prompt.legStatus,
    partial: prompt.partial,
  });

  const customHandlers: Record<string, EventHandler> = {
    [GraphEvents.ON_MESSAGE_DELTA]: {
      async handle(_event, data) {
        if (abortSignal.aborted) {
          return;
        }
        const delta = extractDeltaText(data);
        if (!delta) {
          return;
        }
        const emitted = emitSynthesisDelta(res, delta);
        if (!emitted) {
          return;
        }
        emittedText += delta;
        try {
          await setSynthesisState({ emittedIndex: emittedText.length, text: emittedText });
        } catch (err) {
          logger.warn('[runCouncilSynthesis] setSynthesisState delta update failed', err);
        }
      },
    },
    [GraphEvents.CHAT_MODEL_END]: {
      handle(_event, data) {
        const usage = extractUsage(data);
        if (!usage) {
          return;
        }
        collectedUsage.push({
          ...usage,
          agentId: SYNTHESIS_AGENT_ID,
          model: llmConfig.model as string | undefined,
          usage_type: 'message',
        });
      },
    },
  };

  try {
    const run = await Run.create({
      runId,
      graphConfig: {
        type: 'standard',
        llmConfig,
        tools: [],
        instructions: prompt.system,
      },
      customHandlers,
      returnContent: true,
    });

    const config = {
      runName: 'CouncilSynthesisRun',
      configurable: {
        thread_id: params.streamId,
        provider: llmConfig.provider,
      },
      signal: abortSignal,
      streamMode: 'values',
      recursionLimit: 1,
      version: 'v2',
    } as const;

    await run.processStream({ messages: [new HumanMessage(prompt.user)] }, config);
  } catch (err) {
    if (abortSignal.aborted) {
      aborted = true;
    } else {
      errorMessage = err instanceof Error ? err.message : String(err);
      logger.error('[runCouncilSynthesis] synthesis invocation failed', err);
    }
  }

  if (aborted) {
    await setSynthesisState({
      started: true,
      completed: true,
      emittedIndex: emittedText.length,
      text: emittedText,
    });
    return { emittedText, completed: false, aborted: true };
  }

  if (errorMessage) {
    await setSynthesisState({
      started: true,
      completed: true,
      emittedIndex: emittedText.length,
      text: emittedText,
    });
    return { emittedText, completed: false, aborted: false, error: errorMessage };
  }

  emitSynthesisComplete(res, {
    text: emittedText,
    partial: prompt.partial,
    legStatus: prompt.legStatus,
  });
  await setSynthesisState({
    started: true,
    completed: true,
    emittedIndex: emittedText.length,
    text: emittedText,
  });
  return { emittedText, completed: true, aborted: false };
}

/**
 * Convenience wrapper for the all-legs-failed branch (§D5): emit the
 * distinct `synthesis_skipped_all_failed` event, persist a completed-but-
 * empty synthesis state so resume's all-failed branch fires, and return
 * without invoking an LLM.
 */
export async function skipCouncilSynthesisAllFailed(params: {
  res: Response;
  legStatus: SynthesisState['legStatus'];
  strategy: SynthesisState['strategy'];
  setSynthesisState: (partial: Partial<SynthesisState>) => Promise<void>;
}): Promise<void> {
  emitSynthesisSkippedAllFailed(params.res, { legStatus: params.legStatus });
  await params.setSynthesisState({
    strategy: params.strategy,
    started: true,
    completed: true,
    emittedIndex: 0,
    text: undefined,
    legStatus: params.legStatus,
    partial: false,
  });
}

interface DeltaContent {
  text?: unknown;
  content?: unknown;
  delta?: unknown;
}

function extractDeltaText(data: unknown): string | null {
  if (typeof data === 'string') {
    return data;
  }
  const d = data as DeltaContent;
  if (typeof d?.text === 'string') {
    return d.text;
  }
  if (typeof d?.delta === 'string') {
    return d.delta;
  }
  if (Array.isArray(d?.content)) {
    let text = '';
    for (const part of d.content as unknown[]) {
      const p = part as { type?: string; text?: string };
      if (p?.type === 'text' && typeof p.text === 'string') {
        text += p.text;
      }
    }
    return text || null;
  }
  return null;
}

function extractUsage(data: unknown): Omit<UsageMetadata, 'agentId' | 'model' | 'usage_type'> | null {
  const d = data as {
    output?: { usage_metadata?: UsageMetadata };
    usage_metadata?: UsageMetadata;
    usage?: UsageMetadata;
  };
  const raw = d?.output?.usage_metadata ?? d?.usage_metadata ?? d?.usage;
  if (!raw) {
    return null;
  }
  const {
    agentId: _a,
    model: _m,
    usage_type: _u,
    ...rest
  } = raw as UsageMetadata;
  return rest;
}
