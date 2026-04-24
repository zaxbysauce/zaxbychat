export enum Providers {
  OPENAI = 'openAI',
  ANTHROPIC = 'anthropic',
  AZURE = 'azureOpenAI',
  GOOGLE = 'google',
  VERTEXAI = 'vertexai',
  BEDROCK = 'bedrock',
  MISTRALAI = 'mistralai',
  MISTRAL = 'mistral',
  DEEPSEEK = 'deepseek',
  MOONSHOT = 'moonshot',
  OPENROUTER = 'openrouter',
  XAI = 'xai',
}

export const Run = { create: jest.fn(), processStream: jest.fn() };
export const Constants = {};

export const GraphEvents = {
  ON_MESSAGE_DELTA: 'on_message_delta',
  ON_RUN_STEP: 'on_run_step',
  ON_RUN_STEP_DELTA: 'on_run_step_delta',
  ON_RUN_STEP_COMPLETED: 'on_run_step_completed',
  CHAT_MODEL_END: 'chat_model_end',
  CHAT_MODEL_STREAM: 'chat_model_stream',
  TOOL_END: 'tool_end',
  TOOL_START: 'tool_start',
  ON_REASONING_DELTA: 'on_reasoning_delta',
  ON_TOOL_EXECUTE: 'on_tool_execute',
  ON_SUMMARIZE_START: 'on_summarize_start',
  ON_SUMMARIZE_DELTA: 'on_summarize_delta',
  ON_SUMMARIZE_COMPLETE: 'on_summarize_complete',
};

export function labelContentByAgent(
  content: unknown[],
  _agentIdMap: Record<number, string>,
  _agentNames: Record<string, string>,
): unknown[] {
  return content;
}

export const extractImageDimensions = jest.fn();
export const getTokenCountForMessage = jest.fn().mockReturnValue(0);
export const estimateOpenAIImageTokens = jest.fn().mockReturnValue(0);
export const estimateAnthropicImageTokens = jest.fn().mockReturnValue(0);
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
