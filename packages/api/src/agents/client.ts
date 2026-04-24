import { ContentTypes, isAgentsEndpoint } from 'librechat-data-provider';
import {
  extractImageDimensions,
  getTokenCountForMessage,
  estimateOpenAIImageTokens,
  estimateAnthropicImageTokens,
} from '@librechat/agents';
import type { Agent, TMessage } from 'librechat-data-provider';
import type { BaseMessage } from '@langchain/core/messages';
import type { ServerRequest } from '~/types';
import Tokenizer from '~/utils/tokenizer';
import { logAxiosError } from '~/utils';

export const omitTitleOptions = new Set([
  'stream',
  'thinking',
  'streaming',
  'clientOptions',
  'thinkingConfig',
  'thinkingBudget',
  'includeThoughts',
  'maxOutputTokens',
  'additionalModelRequestFields',
]);

export function payloadParser({ req, endpoint }: { req: ServerRequest; endpoint: string }) {
  if (isAgentsEndpoint(endpoint)) {
    return;
  }
  return req.body?.endpointOption?.model_parameters;
}

/**
 * Anthropic's API consistently reports ~10% more tokens than the local
 * claude tokenizer due to internal message framing and content encoding.
 * Verified empirically across content types via the count_tokens endpoint.
 */
export const CLAUDE_TOKEN_CORRECTION = 1.1;
const IMAGE_TOKEN_SAFETY_MARGIN = 1.05;
const BASE64_BYTES_PER_PDF_PAGE = 75_000;
const PDF_TOKENS_PER_PAGE_CLAUDE = 2000;
const PDF_TOKENS_PER_PAGE_OPENAI = 1500;
const URL_DOCUMENT_FALLBACK_TOKENS = 2000;

type ContentBlock = {
  type?: string;
  image_url?: string | { url?: string };
  source?: { type?: string; data?: string; media_type?: string; content?: unknown[] };
  source_type?: string;
  mime_type?: string;
  data?: string;
  text?: string;
  tool_call?: { name?: string; args?: string; output?: string };
};

function estimateImageDataTokens(data: string, isClaude: boolean): number {
  const dims = extractImageDimensions(data);
  if (dims == null) {
    return 1024;
  }
  const raw = isClaude
    ? estimateAnthropicImageTokens(dims.width, dims.height)
    : estimateOpenAIImageTokens(dims.width, dims.height);
  return Math.ceil(raw * IMAGE_TOKEN_SAFETY_MARGIN);
}

function estimateImageBlockTokens(block: ContentBlock, isClaude: boolean): number {
  let base64Data: string | undefined;
  if (block.type === 'image_url') {
    const url = typeof block.image_url === 'string' ? block.image_url : block.image_url?.url;
    if (typeof url === 'string' && url.startsWith('data:')) {
      base64Data = url;
    }
  } else if (block.type === 'image') {
    if (block.source?.type === 'base64' && typeof block.source.data === 'string') {
      base64Data = block.source.data;
    }
  }
  if (base64Data == null) {
    return 1024;
  }
  return estimateImageDataTokens(base64Data, isClaude);
}

function estimateDocumentBlockTokens(
  block: ContentBlock,
  isClaude: boolean,
  countTokens?: (text: string) => number,
): number {
  const pdfPerPage = isClaude ? PDF_TOKENS_PER_PAGE_CLAUDE : PDF_TOKENS_PER_PAGE_OPENAI;

  if (typeof block.source_type === 'string') {
    if (block.source_type === 'text' && typeof block.text === 'string') {
      return countTokens != null ? countTokens(block.text) : Math.ceil(block.text.length / 4);
    }
    if (block.source_type === 'base64' && typeof block.data === 'string') {
      const mime = (block.mime_type ?? '').split(';')[0];
      if (mime === 'application/pdf' || mime === '') {
        return Math.max(1, Math.ceil(block.data.length / BASE64_BYTES_PER_PDF_PAGE)) * pdfPerPage;
      }
      if (mime.startsWith('image/')) {
        return estimateImageDataTokens(block.data, isClaude);
      }
      return countTokens != null ? countTokens(block.data) : Math.ceil(block.data.length / 4);
    }
    return URL_DOCUMENT_FALLBACK_TOKENS;
  }

  if (block.source != null) {
    if (block.source.type === 'text' && typeof block.source.data === 'string') {
      return countTokens != null
        ? countTokens(block.source.data)
        : Math.ceil(block.source.data.length / 4);
    }
    if (block.source.type === 'base64' && typeof block.source.data === 'string') {
      const mime = (block.source.media_type ?? '').split(';')[0];
      if (mime === 'application/pdf' || mime === '') {
        const pages = Math.max(1, Math.ceil(block.source.data.length / BASE64_BYTES_PER_PDF_PAGE));
        return pages * pdfPerPage;
      }
      if (mime.startsWith('image/')) {
        return estimateImageDataTokens(block.source.data, isClaude);
      }
      return countTokens != null
        ? countTokens(block.source.data)
        : Math.ceil(block.source.data.length / 4);
    }
    if (block.source.type === 'url') {
      return URL_DOCUMENT_FALLBACK_TOKENS;
    }
    if (block.source.type === 'content' && Array.isArray(block.source.content)) {
      let tokens = 0;
      for (const inner of block.source.content) {
        const innerBlock = inner as ContentBlock | null;
        if (
          innerBlock?.type === 'image' &&
          innerBlock.source?.type === 'base64' &&
          typeof innerBlock.source.data === 'string'
        ) {
          tokens += estimateImageDataTokens(innerBlock.source.data, isClaude);
        }
      }
      return tokens;
    }
  }

  return URL_DOCUMENT_FALLBACK_TOKENS;
}

/**
 * Estimates token cost for image and document blocks in a message's
 * content array. Covers: image_url, image, image_file, document, file.
 */
export function estimateMediaTokensForMessage(
  content: unknown,
  isClaude: boolean,
  getTokenCount?: (text: string) => number,
): number {
  if (!Array.isArray(content)) {
    return 0;
  }
  let tokens = 0;
  for (const block of content as ContentBlock[]) {
    if (block == null || typeof block !== 'object' || typeof block.type !== 'string') {
      continue;
    }
    const type = block.type;
    if (type === 'image_url' || type === 'image' || type === 'image_file') {
      tokens += estimateImageBlockTokens(block, isClaude);
      continue;
    }
    if (type === 'document' || type === 'file') {
      tokens += estimateDocumentBlockTokens(block, isClaude, getTokenCount);
    }
  }
  return tokens;
}

/**
 * Single-pass token counter for formatted messages (plain objects with role/content/name).
 * Handles text, tool_call, image, and document content types in one iteration,
 * then applies Claude correction when applicable.
 */
export function countFormattedMessageTokens(
  message: Partial<Record<string, unknown>>,
  encoding: Parameters<typeof Tokenizer.getTokenCount>[1],
): number {
  const countTokens = (text: string) => Tokenizer.getTokenCount(text, encoding);
  const isClaude = encoding === 'claude';

  let numTokens = 3;

  const processValue = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item == null || typeof item !== 'object') {
          continue;
        }
        const block = item as ContentBlock;
        const type = block.type;
        if (typeof type !== 'string') {
          continue;
        }

        if (type === ContentTypes.THINK || type === ContentTypes.ERROR) {
          continue;
        }

        if (
          type === ContentTypes.IMAGE_URL ||
          type === 'image' ||
          type === ContentTypes.IMAGE_FILE
        ) {
          numTokens += estimateImageBlockTokens(block, isClaude);
          continue;
        }

        if (type === 'document' || type === 'file') {
          numTokens += estimateDocumentBlockTokens(block, isClaude, countTokens);
          continue;
        }

        if (type === ContentTypes.TOOL_CALL && block.tool_call != null) {
          const { name, args, output } = block.tool_call;
          if (typeof name === 'string' && name) {
            numTokens += countTokens(name);
          }
          if (typeof args === 'string' && args) {
            numTokens += countTokens(args);
          }
          if (typeof output === 'string' && output) {
            numTokens += countTokens(output);
          }
          continue;
        }

        const nestedValue = (item as Record<string, unknown>)[type];
        if (nestedValue != null) {
          processValue(nestedValue);
        }
      }
      return;
    }

    if (typeof value === 'string') {
      numTokens += countTokens(value);
    } else if (typeof value === 'number') {
      numTokens += countTokens(value.toString());
    } else if (typeof value === 'boolean') {
      numTokens += countTokens(value.toString());
    }
  };

  for (const [key, value] of Object.entries(message)) {
    processValue(value);
    if (key === 'name') {
      numTokens += 1;
    }
  }

  return isClaude ? Math.ceil(numTokens * CLAUDE_TOKEN_CORRECTION) : numTokens;
}

export function createTokenCounter(encoding: Parameters<typeof Tokenizer.getTokenCount>[1]) {
  const isClaude = encoding === 'claude';
  const countTokens = (text: string) => Tokenizer.getTokenCount(text, encoding);
  return function (message: BaseMessage) {
    const count = getTokenCountForMessage(
      message,
      countTokens,
      encoding as 'claude' | 'o200k_base',
    );
    return isClaude ? Math.ceil(count * CLAUDE_TOKEN_CORRECTION) : count;
  };
}

export function logToolError(_graph: unknown, error: unknown, toolId: string) {
  logAxiosError({
    error,
    message: `[api/server/controllers/agents/client.js #chatCompletion] Tool Error "${toolId}"`,
  });
}

export {
  findPrimaryAgentId,
  createMultiAgentMapper,
  type MultiAgentMapperOptions,
} from './mapper';
