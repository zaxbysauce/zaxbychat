/**
 * Phase 6 port test — documents.ts.
 *
 * Targets donor document_retrieval.py (SHA
 * df2301bc8e97fa8062859d2228d4bbf17c0dca95):
 *   - `_extract_reupload_hash` (lines 18-29).
 *   - `_normalize_uid_for_dedup` (lines 32-60).
 *   - `_group_aware_dedup` (lines 63-100).
 *   - `filter_relevant` distance gating, reranker override, indexed file
 *     filtering, no-match flag (lines 146-261).
 *   - `expand_window` adapter-injected path + two-tier ordering (lines
 *     262-387).
 *   - No-adapter path returns input unchanged.
 */
import {
  DocumentRetrievalService,
  extractReuploadHash,
  normalizeUidForDedup,
  groupAwareDedup,
  normalizeMetadata,
} from '../documents';
import type { RagSource, RetrievalRecord, VectorStoreAdapter } from '../types';

describe('extractReuploadHash', () => {
  it('extracts 8-hex hash from reupload-safe IDs', () => {
    expect(extractReuploadHash('42_abc12345_default_0', '42')).toBe('abc12345');
  });

  it('returns null for legacy IDs', () => {
    expect(extractReuploadHash('42_0', '42')).toBeNull();
    expect(extractReuploadHash('42_512_0', '42')).toBeNull();
  });

  it('returns null when file_id prefix does not match', () => {
    expect(extractReuploadHash('99_abc12345_default_0', '42')).toBeNull();
  });

  it('rejects non-hex 8-char segments', () => {
    expect(extractReuploadHash('42_ghijklmn_default_0', '42')).toBeNull();
  });
});

describe('normalizeUidForDedup', () => {
  it('strips scale component from multi-scale UIDs', () => {
    expect(normalizeUidForDedup('doc1_512_3')).toBe('doc1_3');
  });

  it('leaves default UIDs unchanged', () => {
    expect(normalizeUidForDedup('doc1_3')).toBe('doc1_3');
  });

  it('leaves 3-part file_ids with numeric tail unchanged (not multi-scale)', () => {
    expect(normalizeUidForDedup('prefix_middle_3')).toBe('prefix_middle_3');
  });
});

describe('groupAwareDedup', () => {
  const mk = (fileId: string, idx: number): RagSource => ({
    text: '',
    fileId,
    score: 1,
    metadata: { chunk_index: idx },
  });

  it('caps per-doc chunks and breadth', () => {
    const sources = [
      mk('a', 0), mk('a', 1), mk('a', 2),
      mk('b', 0), mk('c', 0), mk('d', 0), mk('e', 0), mk('f', 0),
    ];
    const out = groupAwareDedup(sources, 2, 5);
    const counts = out.reduce<Record<string, number>>((acc, s) => {
      acc[s.fileId] = (acc[s.fileId] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts.a).toBe(2);
    expect(Object.keys(counts).length).toBe(5);
  });

  it('preserves relevance order', () => {
    const sources = [mk('a', 0), mk('b', 0), mk('a', 1)];
    const out = groupAwareDedup(sources, 2, 5);
    expect(out.map((s) => [s.fileId, s.metadata.chunk_index])).toEqual([
      ['a', 0], ['b', 0], ['a', 1],
    ]);
  });
});

describe('normalizeMetadata', () => {
  it('returns dicts as-is', () => {
    expect(normalizeMetadata({ k: 'v' })).toEqual({ k: 'v' });
  });

  it('parses JSON strings', () => {
    expect(normalizeMetadata('{"k":"v"}')).toEqual({ k: 'v' });
  });

  it('returns {} on unparseable input', () => {
    expect(normalizeMetadata('not json')).toEqual({});
    expect(normalizeMetadata(null)).toEqual({});
    expect(normalizeMetadata(42)).toEqual({});
  });
});

describe('DocumentRetrievalService.filterRelevant', () => {
  it('filters by _distance threshold when not reranked', async () => {
    const svc = new DocumentRetrievalService({
      config: { maxDistanceThreshold: 0.5, retrievalTopK: 5 },
    });
    const records: RetrievalRecord[] = [
      { id: '1', file_id: 'a', _distance: 0.3, text: 'close' },
      { id: '2', file_id: 'b', _distance: 0.9, text: 'far' },
    ];
    const { sources, noMatch } = await svc.filterRelevant(records);
    expect(sources.map((s) => s.fileId)).toEqual(['a']);
    expect(noMatch).toBe(false);
  });

  it('sets noMatch when all candidates exceed the threshold', async () => {
    const svc = new DocumentRetrievalService({
      config: { maxDistanceThreshold: 0.1, retrievalTopK: 5 },
    });
    const records: RetrievalRecord[] = [
      { id: '1', file_id: 'a', _distance: 0.9 },
      { id: '2', file_id: 'b', _distance: 0.8 },
    ];
    const { sources, noMatch } = await svc.filterRelevant(records);
    expect(sources).toHaveLength(0);
    expect(noMatch).toBe(true);
  });

  it('skips distance filter when reranked and prefers _rerank_score', async () => {
    const svc = new DocumentRetrievalService({
      config: { maxDistanceThreshold: 0.1 },
    });
    const records: RetrievalRecord[] = [
      { id: '1', file_id: 'a', _distance: 0.9, _rerank_score: 0.95 },
    ];
    const { sources } = await svc.filterRelevant(records, { reranked: true });
    expect(sources).toHaveLength(1);
    expect(sources[0].score).toBeCloseTo(0.95, 10);
  });

  it('filters by indexedFileIds (atomic visibility)', async () => {
    const svc = new DocumentRetrievalService({
      config: { maxDistanceThreshold: 1.0 },
    });
    const records: RetrievalRecord[] = [
      { id: '1', file_id: 'a', _distance: 0.1 },
      { id: '2', file_id: 'b', _distance: 0.1 },
    ];
    const { sources } = await svc.filterRelevant(records, {
      indexedFileIds: new Set(['a']),
    });
    expect(sources.map((s) => s.fileId)).toEqual(['a']);
  });

  it('honors retrievalTopK cap', async () => {
    const svc = new DocumentRetrievalService({
      config: { maxDistanceThreshold: 1.0, retrievalTopK: 2, newDedupPolicy: false },
    });
    const records: RetrievalRecord[] = [
      { id: '1', file_id: 'a', _distance: 0.1 },
      { id: '2', file_id: 'b', _distance: 0.2 },
      { id: '3', file_id: 'c', _distance: 0.3 },
    ];
    const { sources } = await svc.filterRelevant(records);
    expect(sources).toHaveLength(2);
  });
});

describe('DocumentRetrievalService.expandWindow', () => {
  it('returns input unchanged when no adapter is injected', async () => {
    const svc = new DocumentRetrievalService({
      config: { retrievalWindow: 2, maxDistanceThreshold: 1.0, newDedupPolicy: false },
    });
    const input: RagSource[] = [
      { text: 't', fileId: 'a', score: 0.1, metadata: { chunk_index: 5 } },
    ];
    const out = await svc.expandWindow(input);
    expect(out).toBe(input);
  });

  it('fetches adjacent chunks via adapter and applies two-tier ordering', async () => {
    const store: Record<string, RetrievalRecord> = {
      'a_4': { id: 'a_4', file_id: 'a', _distance: 0.4, text: 'before', metadata: { chunk_index: 4 } },
      'a_5': { id: 'a_5', file_id: 'a', _distance: 0.1, text: 'hit', metadata: { chunk_index: 5 } },
      'a_6': { id: 'a_6', file_id: 'a', _distance: 0.5, text: 'after', metadata: { chunk_index: 6 } },
    };
    const adapter: VectorStoreAdapter = {
      async getChunksByUid(uids) {
        return uids.map((u) => store[u]).filter(Boolean);
      },
    };
    const svc = new DocumentRetrievalService({
      config: {
        retrievalWindow: 1,
        retrievalTopK: 10,
        maxDistanceThreshold: 1.0,
        newDedupPolicy: false,
      },
      adapter,
    });
    const input: RagSource[] = [
      { text: 'hit', fileId: 'a', score: 0.1, metadata: { chunk_index: 5 } },
    ];
    const out = await svc.expandWindow(input);
    const indices = out.map((s) => Number(s.metadata.chunk_index));
    expect(indices).toEqual([5, 4, 6].sort((a, b) => a - b));
  });
});
