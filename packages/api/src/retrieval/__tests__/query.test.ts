/**
 * Phase 6 port test — query.ts.
 *
 * Targets donor query_transformer.py (SHA
 * 848f382538778805fb7c2fca2037ff22456a7268):
 *   - `_is_exact_or_document_query` skip heuristic (lines 16-37).
 *   - `transform` cache hit + miss + error fallback (lines 102-207).
 *   - `generate_hyde` minimum-length gate (lines 210-251).
 *   - LRU eviction semantics.
 *   - Optional Redis path read/write precedence.
 */
import {
  QueryTransformer,
  isExactOrDocumentQuery,
  makeCacheKey,
} from '../query';
import type { ChatCompletionFn, RedisLike } from '../query';

describe('isExactOrDocumentQuery', () => {
  it('flags quoted phrases', () => {
    expect(isExactOrDocumentQuery('"exact phrase" here')).toBe(true);
  });

  it('flags filename references', () => {
    expect(isExactOrDocumentQuery('in report.pdf')).toBe(true);
    expect(isExactOrDocumentQuery('from config.yaml please')).toBe(true);
  });

  it('flags short non-question lookups', () => {
    expect(isExactOrDocumentQuery('John Doe email')).toBe(true);
    expect(isExactOrDocumentQuery('meeting notes')).toBe(true);
  });

  it('allows broader question-style queries through', () => {
    expect(isExactOrDocumentQuery('how does RRF work')).toBe(false);
    expect(isExactOrDocumentQuery('what is the meaning of this')).toBe(false);
  });

  it('allows long non-quoted queries through', () => {
    expect(isExactOrDocumentQuery('give me insights on the onboarding process')).toBe(false);
  });
});

describe('makeCacheKey', () => {
  it('produces stable deterministic keys', () => {
    const k1 = makeCacheKey('m', 'step_back', 'q');
    const k2 = makeCacheKey('m', 'step_back', 'q');
    expect(k1).toBe(k2);
    expect(k1.startsWith('query_transform:')).toBe(true);
  });

  it('differs by transform type', () => {
    expect(makeCacheKey('m', 'step_back', 'q')).not.toBe(
      makeCacheKey('m', 'hyde', 'q'),
    );
  });
});

const mkChat = (impl: (msgs: { content: string }[]) => Promise<string>): ChatCompletionFn =>
  async (messages) => impl(messages as { content: string }[]);

describe('QueryTransformer.transform', () => {
  it('skips transform for exact queries', async () => {
    const chat = jest.fn<Promise<string>, unknown[]>(async () => 'broader');
    const qt = new QueryTransformer({ chatCompletion: chat as ChatCompletionFn });
    const variants = await qt.transform('"exact"');
    expect(variants).toEqual([{ type: 'original', text: '"exact"' }]);
    expect(chat).not.toHaveBeenCalled();
  });

  it('returns original + step_back on success', async () => {
    const chat = mkChat(async () => 'broader concept');
    const qt = new QueryTransformer({ chatCompletion: chat });
    const variants = await qt.transform('how do caches affect retrieval');
    expect(variants).toEqual([
      { type: 'original', text: 'how do caches affect retrieval' },
      { type: 'step_back', text: 'broader concept' },
    ]);
  });

  it('returns original only when stepback_enabled=false', async () => {
    const chat = jest.fn<Promise<string>, unknown[]>(async () => 'broader');
    const qt = new QueryTransformer({
      chatCompletion: chat as ChatCompletionFn,
      config: { stepbackEnabled: false },
    });
    const variants = await qt.transform('how do caches affect retrieval');
    expect(variants).toEqual([
      { type: 'original', text: 'how do caches affect retrieval' },
    ]);
    expect(chat).not.toHaveBeenCalled();
  });

  it('falls back to original-only on LLM error', async () => {
    const chat: ChatCompletionFn = async () => {
      throw new Error('boom');
    };
    const qt = new QueryTransformer({ chatCompletion: chat });
    const variants = await qt.transform('how does RRF work');
    expect(variants).toEqual([{ type: 'original', text: 'how does RRF work' }]);
  });

  it('serves cached result from LRU on second call (no LLM re-call)', async () => {
    const chat = jest.fn<Promise<string>, unknown[]>(async () => 'broader concept');
    const qt = new QueryTransformer({ chatCompletion: chat as ChatCompletionFn });
    const q = 'how does chunking affect retrieval';
    const first = await qt.transform(q);
    const second = await qt.transform(q);
    expect(second).toEqual(first);
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('appends HyDE passage when enabled and passage is long enough', async () => {
    const chat = jest
      .fn<Promise<string>, unknown[]>()
      .mockResolvedValueOnce('broader concept')
      .mockResolvedValueOnce('HyDE passage that is comfortably above the twenty char gate.');
    const qt = new QueryTransformer({
      chatCompletion: chat as ChatCompletionFn,
      config: { hydeEnabled: true },
    });
    const variants = await qt.transform('how does HyDE help retrieval');
    const types = variants.map((v) => v.type);
    expect(types).toEqual(['original', 'step_back', 'hyde']);
  });

  it('drops HyDE passage shorter than 20 chars', async () => {
    const chat = jest
      .fn<Promise<string>, unknown[]>()
      .mockResolvedValueOnce('broader concept')
      .mockResolvedValueOnce('short');
    const qt = new QueryTransformer({
      chatCompletion: chat as ChatCompletionFn,
      config: { hydeEnabled: true },
    });
    const variants = await qt.transform('how does HyDE help retrieval');
    expect(variants.map((v) => v.type)).toEqual(['original', 'step_back']);
  });
});

describe('QueryTransformer Redis path', () => {
  it('reads cached step_back from Redis before falling back to LRU', async () => {
    const cachedVariants = [
      { type: 'original', text: 'q' },
      { type: 'step_back', text: 'cached-broader' },
    ];
    const redis: RedisLike = {
      get: jest.fn<Promise<string | null>, [string]>(async () => JSON.stringify(cachedVariants)),
      setex: jest.fn<Promise<unknown>, [string, number, string]>(async () => 'OK'),
    };
    const chat = jest.fn<Promise<string>, unknown[]>(async () => 'unused');
    const qt = new QueryTransformer({
      chatCompletion: chat as ChatCompletionFn,
      redis,
    });
    const variants = await qt.transform('how does caching affect retrieval');
    expect(variants).toEqual(cachedVariants);
    expect(chat).not.toHaveBeenCalled();
  });

  it('writes to Redis with TTL on cache miss', async () => {
    const setex = jest.fn<Promise<unknown>, [string, number, string]>(async () => 'OK');
    const redis: RedisLike = {
      get: async () => null,
      setex,
    };
    const chat = mkChat(async () => 'broader');
    const qt = new QueryTransformer({
      chatCompletion: chat,
      redis,
      config: { queryTransformCacheTtlSec: 77 },
    });
    await qt.transform('how does chunking affect retrieval');
    expect(setex).toHaveBeenCalled();
    const [, ttl] = setex.mock.calls[0];
    expect(ttl).toBe(77);
  });
});
