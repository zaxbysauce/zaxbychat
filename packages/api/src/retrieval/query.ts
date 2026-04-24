/**
 * Phase 6 — query transformation (step-back + HyDE).
 *
 * Port of ragappv3 `backend/app/services/query_transformer.py` (donor SHA
 * 848f382538778805fb7c2fca2037ff22456a7268, lines 1-252). Preserves:
 *
 *   - `_is_exact_or_document_query` skip heuristic (donor lines 16-37).
 *   - Step-back prompt template + HyDE passage template (donor lines
 *     107-176 + 217-251).
 *   - Two-tier cache (optional Redis + in-memory LRU) with MD5 keys.
 *
 * Dependency replacements (D-P6-4 lock):
 *   - `LLMClient.chat_completion` → injected `ChatCompletionFn`.
 *   - `redis` Python client → optional `RedisLike` interface (any client
 *     exposing `get`/`setex`). No coupling to a specific Redis package.
 *   - `hashlib.md5` → `node:crypto`.
 *   - `OrderedDict` LRU → `Map` with size-cap cycling (same semantics).
 */

import { createHash } from 'node:crypto';

export type TransformChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type ChatCompletionOptions = {
  maxTokens: number;
  temperature: number;
};

export type ChatCompletionFn = (
  messages: TransformChatMessage[],
  options: ChatCompletionOptions,
) => Promise<string>;

export type RedisLike = {
  get(key: string): Promise<string | null>;
  setex(key: string, ttlSeconds: number, value: string): Promise<unknown>;
};

export type QueryVariantType = 'original' | 'step_back' | 'hyde';
export type QueryVariant = { type: QueryVariantType; text: string };

export type QueryTransformerConfig = {
  chatModel: string;
  stepbackEnabled: boolean;
  hydeEnabled: boolean;
  queryTransformTemperature: number;
  hydeTemperature: number;
  queryTransformCacheTtlSec: number;
  lruCapacity: number;
};

export const DEFAULT_QUERY_TRANSFORMER_CONFIG: QueryTransformerConfig = {
  chatModel: 'default',
  stepbackEnabled: true,
  hydeEnabled: false,
  queryTransformTemperature: 0.1,
  hydeTemperature: 0.3,
  queryTransformCacheTtlSec: 60 * 60 * 24,
  lruCapacity: 1024,
};

const FILENAME_EXT_RE = /\b[\w-]+\.(pdf|docx?|xlsx?|csv|txt|md|yaml|yml|json|html?|pptx?)\b/i;
const QUOTED_PHRASE_RE = /"[^"]{3,}"/;
const QUESTION_WORDS = new Set([
  'what', 'how', 'why', 'when', 'where', 'which', 'who', 'explain', 'describe',
]);

/**
 * Donor `_is_exact_or_document_query` (query_transformer.py:16-37).
 * Queries matching any clause skip step-back/HyDE broadening.
 */
export function isExactOrDocumentQuery(query: string): boolean {
  if (QUOTED_PHRASE_RE.test(query)) return true;
  if (FILENAME_EXT_RE.test(query)) return true;
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (words.length > 3) return false;
  const hasQuestionWord = words.some((w) =>
    QUESTION_WORDS.has(w.toLowerCase().replace(/\?+$/, '')),
  );
  return !hasQuestionWord;
}

export function makeCacheKey(
  chatModel: string,
  transformType: 'step_back' | 'hyde',
  queryText: string,
): string {
  const keyData = JSON.stringify({ model: chatModel, type: transformType, query: queryText });
  const digest = createHash('md5').update(keyData).digest('hex');
  return `query_transform:${digest}`;
}

class LruCache<V> {
  private readonly capacity: number;
  private readonly map = new Map<string, V>();

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  get(key: string): V | undefined {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key) as V;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.capacity) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, value);
  }
}

export class QueryTransformer {
  private readonly config: QueryTransformerConfig;
  private readonly chatCompletion: ChatCompletionFn;
  private readonly redis?: RedisLike;
  private readonly stepBackCache: LruCache<QueryVariant[]>;
  private readonly hydeCache: LruCache<string>;

  constructor(options: {
    chatCompletion: ChatCompletionFn;
    config?: Partial<QueryTransformerConfig>;
    redis?: RedisLike;
  }) {
    this.chatCompletion = options.chatCompletion;
    this.config = { ...DEFAULT_QUERY_TRANSFORMER_CONFIG, ...(options.config ?? {}) };
    this.redis = options.redis;
    this.stepBackCache = new LruCache(this.config.lruCapacity);
    this.hydeCache = new LruCache(this.config.lruCapacity);
  }

  /**
   * Donor `transform` (query_transformer.py:102-207). Returns
   * `[original]` for exact/document queries; `[original, step_back]`
   * when step-back enabled and succeeds; appends `hyde` passage when
   * `hydeEnabled` and generation returns a sufficient passage.
   */
  async transform(query: string): Promise<QueryVariant[]> {
    if (isExactOrDocumentQuery(query)) {
      return [{ type: 'original', text: query }];
    }
    if (!this.config.stepbackEnabled) {
      return [{ type: 'original', text: query }];
    }

    const cacheKey = makeCacheKey(this.config.chatModel, 'step_back', query);
    const cached = await this.readCache<QueryVariant[]>(cacheKey, this.stepBackCache);
    if (cached) {
      return this.maybeAppendHyde(query, cached);
    }

    const variants = await this.runStepBack(query);
    await this.writeCache(cacheKey, variants, this.stepBackCache);
    return this.maybeAppendHyde(query, variants);
  }

  /**
   * Donor `generate_hyde` (query_transformer.py:210-251). Returns a
   * short factual passage or `null` when generation fails or returns
   * fewer than 20 characters.
   */
  async generateHyde(query: string): Promise<string | null> {
    const messages: TransformChatMessage[] = [
      {
        role: 'system',
        content:
          'You are a knowledgeable assistant. Write a short, factual passage (2-4 sentences) ' +
          'that directly answers the following question. Write as if you are the document that ' +
          'contains the answer. Be specific and use domain-appropriate language. Do not hedge ' +
          "or say 'I think' — write as a confident factual passage.",
      },
      { role: 'user', content: `Question: ${query}\n\nPassage:` },
    ];
    try {
      const raw = await this.chatCompletion(messages, {
        maxTokens: 350,
        temperature: this.config.hydeTemperature,
      });
      const trimmed = raw.trim();
      if (trimmed.length < 20) return null;
      return trimmed;
    } catch {
      return null;
    }
  }

  private async runStepBack(query: string): Promise<QueryVariant[]> {
    const messages: TransformChatMessage[] = [
      {
        role: 'system',
        content:
          'You are a query transformation assistant. Your task is to generate a broader, ' +
          "more general version of the user's question that captures the high-level intent " +
          'and underlying concepts.',
      },
      {
        role: 'user',
        content:
          'Generate a broader, more general version of this question that captures the ' +
          `underlying concept:\nOriginal: ${query}\nStep-back:`,
      },
    ];
    try {
      const stepBack = await this.chatCompletion(messages, {
        maxTokens: 100,
        temperature: this.config.queryTransformTemperature,
      });
      if (stepBack && stepBack.trim()) {
        return [
          { type: 'original', text: query },
          { type: 'step_back', text: stepBack.trim() },
        ];
      }
    } catch {
      return [{ type: 'original', text: query }];
    }
    return [{ type: 'original', text: query }];
  }

  private async maybeAppendHyde(
    query: string,
    variants: QueryVariant[],
  ): Promise<QueryVariant[]> {
    if (!this.config.hydeEnabled) return variants;

    const hydeKey = makeCacheKey(this.config.chatModel, 'hyde', query);
    const cachedHyde = await this.readCache<string>(hydeKey, this.hydeCache);
    const passage = cachedHyde ?? (await this.generateAndCacheHyde(query, hydeKey));
    if (!passage) return variants;

    return [...variants, { type: 'hyde', text: passage }];
  }

  private async generateAndCacheHyde(query: string, hydeKey: string): Promise<string | null> {
    const passage = await this.generateHyde(query);
    if (!passage) return null;
    await this.writeCache(hydeKey, passage, this.hydeCache);
    return passage;
  }

  private async readCache<V>(key: string, lru: LruCache<V>): Promise<V | null> {
    if (this.redis) {
      try {
        const raw = await this.redis.get(key);
        if (raw) return JSON.parse(raw) as V;
      } catch {
        // fall through to LRU
      }
    }
    return lru.get(key) ?? null;
  }

  private async writeCache<V>(key: string, value: V, lru: LruCache<V>): Promise<void> {
    if (this.redis) {
      try {
        await this.redis.setex(key, this.config.queryTransformCacheTtlSec, JSON.stringify(value));
      } catch {
        // LRU still captures it below
      }
    }
    lru.set(key, value);
  }
}
