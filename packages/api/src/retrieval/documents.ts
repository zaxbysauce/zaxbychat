/**
 * Phase 6 — document retrieval helpers.
 *
 * Port of ragappv3 `backend/app/services/document_retrieval.py` (donor SHA
 * df2301bc8e97fa8062859d2228d4bbf17c0dca95, lines 1-420). Three semantic
 * units preserved:
 *
 *   - Distance/score filtering with reranker-aware gating
 *     (donor lines 136-227).
 *   - Group-aware dedup cap (Issue #12; donor lines 73-100).
 *   - Window expansion via optional `VectorStoreAdapter` (donor lines
 *     262-387) — in zaxbychat there is no vector store, so the adapter
 *     is optional and `expandWindow` is a no-op when absent.
 *
 * Zero Python-only deps. `settings.*` globals replaced with per-call or
 * constructor-injected `DocumentRetrievalConfig`.
 */

import type {
  RagSource,
  ChunkMetadata,
  RetrievalRecord,
  VectorStoreAdapter,
} from './types';

const REUPLOAD_HASH_RE = /^[0-9a-f]{8}$/;

export type DocumentRetrievalConfig = {
  maxDistanceThreshold: number;
  retrievalTopK: number;
  retrievalWindow: number;
  relevanceThreshold: number;
  newDedupPolicy: boolean;
  perDocChunkCap: number;
  uniqueDocsInTopK: number;
};

export const DEFAULT_DOCUMENT_RETRIEVAL_CONFIG: DocumentRetrievalConfig = {
  maxDistanceThreshold: 1.0,
  retrievalTopK: 10,
  retrievalWindow: 0,
  relevanceThreshold: 0.0,
  newDedupPolicy: true,
  perDocChunkCap: 2,
  uniqueDocsInTopK: 5,
};

export type FilterRelevantOptions = {
  topK?: number;
  reranked?: boolean;
  indexedFileIds?: Set<string>;
};

export type FilterRelevantResult = {
  sources: RagSource[];
  noMatch: boolean;
};

/**
 * Donor `_extract_reupload_hash` (document_retrieval.py:18-29). Returns
 * the 8-hex-char hash slice from a reupload-safe chunk ID when present,
 * otherwise `null` for legacy IDs.
 */
export function extractReuploadHash(chunkId: string, fileId: string): string | null {
  const prefix = `${fileId}_`;
  if (!chunkId.startsWith(prefix)) {
    return null;
  }
  const rest = chunkId.slice(prefix.length);
  const candidate = rest.split('_', 1)[0];
  return REUPLOAD_HASH_RE.test(candidate) ? candidate : null;
}

/**
 * Donor `_normalize_uid_for_dedup` (document_retrieval.py:32-60). Strips
 * scale suffix from multi-scale UIDs so `doc1_512_3` and `doc1_3` dedup
 * to the same key.
 */
export function normalizeUidForDedup(uid: string): string {
  const lastUnderscore = uid.lastIndexOf('_');
  if (lastUnderscore <= 0) return uid;
  const prefix = uid.slice(0, lastUnderscore);
  const tail = uid.slice(lastUnderscore + 1);
  if (!/^\d+$/.test(tail)) return uid;

  const midUnderscore = prefix.lastIndexOf('_');
  if (midUnderscore <= 0) return uid;
  const mid = prefix.slice(midUnderscore + 1);
  const head = prefix.slice(0, midUnderscore);
  if (!/^\d+$/.test(mid)) return uid;
  return `${head}_${tail}`;
}

/**
 * Donor `_group_aware_dedup` (document_retrieval.py:63-100). Preserves
 * up to `perDocChunkCap` chunks per document and caps breadth at
 * `uniqueDocsInTopK` distinct documents.
 */
export function groupAwareDedup(
  sources: RagSource[],
  perDocChunkCap: number,
  uniqueDocsInTopK: number,
): RagSource[] {
  const selected: RagSource[] = [];
  const countPerDoc = new Map<string, number>();
  const selectedDocs = new Set<string>();

  for (const source of sources) {
    const fileId = source.fileId;
    const docCount = countPerDoc.get(fileId) ?? 0;

    if (docCount >= perDocChunkCap) continue;
    if (selectedDocs.size >= uniqueDocsInTopK && !selectedDocs.has(fileId)) continue;

    selected.push(source);
    countPerDoc.set(fileId, docCount + 1);
    selectedDocs.add(fileId);
  }
  return selected;
}

/**
 * Donor `_normalize_metadata` (document_retrieval.py:388-404). Ensures
 * metadata is a plain object, parsing a JSON string when needed.
 */
export function normalizeMetadata(metadata: unknown): ChunkMetadata {
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    return metadata as ChunkMetadata;
  }
  if (typeof metadata === 'string') {
    try {
      const parsed = JSON.parse(metadata);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as ChunkMetadata;
      }
    } catch {
      return {};
    }
  }
  return {};
}

export class DocumentRetrievalService {
  private readonly config: DocumentRetrievalConfig;
  private readonly adapter?: VectorStoreAdapter;
  private _noMatch = false;

  constructor(options: {
    config?: Partial<DocumentRetrievalConfig>;
    adapter?: VectorStoreAdapter;
  } = {}) {
    this.config = { ...DEFAULT_DOCUMENT_RETRIEVAL_CONFIG, ...(options.config ?? {}) };
    this.adapter = options.adapter;
  }

  get noMatch(): boolean {
    return this._noMatch;
  }

  /**
   * Donor `filter_relevant` (document_retrieval.py:146-261). Applies
   * distance/score gating + group-aware dedup + optional window
   * expansion. `noMatch` flag is set when every candidate exceeded the
   * threshold.
   */
  async filterRelevant(
    results: RetrievalRecord[],
    options: FilterRelevantOptions = {},
  ): Promise<FilterRelevantResult> {
    const topK = options.topK ?? this.config.retrievalTopK;
    const reranked = options.reranked ?? false;
    const indexedFileIds = options.indexedFileIds;
    const threshold = this.config.maxDistanceThreshold;
    const skipDistanceFilter = reranked;
    this._noMatch = false;

    const inputCount = results.length;
    const sources: RagSource[] = [];

    for (const record of results) {
      if (indexedFileIds && record.file_id && !indexedFileIds.has(record.file_id)) {
        continue;
      }

      const hasDistance = record._distance !== undefined;
      let distance = record._distance;
      if (distance === undefined) {
        const score = record.score ?? 1.0;
        distance = score;
      }

      const shouldSkip = computeShouldSkip({
        skipDistanceFilter,
        threshold,
        relevanceThreshold: this.config.relevanceThreshold,
        hasDistance,
        distance,
      });
      if (shouldSkip) continue;

      let sourceScore = distance;
      if (reranked && typeof record._rerank_score === 'number') {
        const raw = record._rerank_score;
        if (raw >= 0 && raw <= 1) {
          sourceScore = raw;
        }
      }

      const rawMeta = normalizeMetadata(record.metadata);
      rawMeta._chunk_id = record.id ?? '';

      sources.push({
        text: record.text ?? '',
        fileId: record.file_id ?? '',
        score: sourceScore,
        metadata: rawMeta,
      });
    }

    const deduped = this.config.newDedupPolicy && sources.length > 0
      ? groupAwareDedup(sources, this.config.perDocChunkCap, this.config.uniqueDocsInTopK)
      : sources;

    const expanded = this.config.retrievalWindow > 0
      ? await this.expandWindow(deduped)
      : deduped;

    const final = expanded.length > topK ? expanded.slice(0, topK) : expanded;

    if (inputCount > 0 && final.length === 0) {
      this._noMatch = true;
    }
    return { sources: final, noMatch: this._noMatch };
  }

  /**
   * Donor `expand_window` (document_retrieval.py:262-387). Requires a
   * `VectorStoreAdapter`; when absent the input list is returned
   * unchanged. Two-tier ordering (file-rank → file-id → chunk-index) is
   * preserved so cross-document relevance survives in-document reading
   * order.
   */
  async expandWindow(sources: RagSource[]): Promise<RagSource[]> {
    if (!this.adapter || sources.length === 0) return sources;

    const window = this.config.retrievalWindow;
    if (window <= 0) return sources;

    const fileChunks = groupByFileAndScale(sources);
    const uidsToFetch = collectAdjacentUids(fileChunks, window);

    if (uidsToFetch.length === 0) return sources;

    const adjacentChunks = await this.adapter.getChunksByUid(uidsToFetch);
    const adjacentLookup = new Map<string, RetrievalRecord>();
    for (const chunk of adjacentChunks) {
      if (chunk.id) adjacentLookup.set(chunk.id, chunk);
    }

    const expandedSources: RagSource[] = [];
    const seenUids = new Set<string>();

    for (const source of sources) {
      const uid = uidForSource(source);
      const dedupKey = normalizeUidForDedup(uid);
      if (seenUids.has(dedupKey)) continue;
      expandedSources.push(source);
      seenUids.add(dedupKey);
    }

    for (const uid of uidsToFetch) {
      const dedupKey = normalizeUidForDedup(uid);
      if (seenUids.has(dedupKey)) continue;
      const chunk = adjacentLookup.get(uid);
      if (!chunk) continue;

      const parts = uid.split('_');
      const chunkScale = parts.length >= 3 ? parts[parts.length - 2] : null;
      const distance = chunk._distance ?? chunk.score ?? 1.0;
      const metadata = normalizeMetadata(chunk.metadata);
      if (chunkScale) metadata.chunk_scale = chunkScale;

      const recordFileId = chunk.file_id ?? parts[0] ?? '';
      expandedSources.push({
        text: chunk.text ?? '',
        fileId: recordFileId,
        score: distance,
        metadata,
      });
      seenUids.add(dedupKey);
    }

    return sortByFileRankAndIndex(expandedSources);
  }

  /**
   * Donor `to_source_metadata` (document_retrieval.py:406-460). Shapes
   * a `RagSource` for downstream source-label display.
   */
  toSourceMetadata(chunk: RagSource, sourceIndex = 0): SourceMetadata {
    const filename =
      chunk.metadata.source_file ||
      chunk.metadata.filename ||
      chunk.metadata.section_title ||
      'Unknown document';
    const section = chunk.metadata.section_title || chunk.metadata.heading || '';
    const chunkIndex = chunk.metadata.chunk_index ?? '';
    const chunkScale = chunk.metadata.chunk_scale ?? '';
    const uniqueId = chunkScale
      ? `${chunk.fileId}_${chunkScale}_${chunkIndex}`
      : `${chunk.fileId}_${chunkIndex}`;
    const sourceLabel = sourceIndex > 0 ? `S${sourceIndex}` : '';
    const rawText = chunk.metadata.raw_text;
    const snippetSource = rawText ? String(rawText) : chunk.text;
    const snippet = snippetSource ? snippetSource.slice(0, 300) : '';
    return {
      id: uniqueId,
      fileId: chunk.fileId,
      filename: String(filename),
      section: String(section),
      sourceLabel,
      snippet,
      score: chunk.score,
      metadata: chunk.metadata,
    };
  }

  /**
   * Donor `format_chunk` (document_retrieval.py:462-478). Formats a
   * chunk for prompt inclusion (distinct from `PromptBuilder.formatChunk`).
   */
  formatChunk(chunk: RagSource): string {
    const sourceTitle =
      chunk.metadata.source_file || chunk.metadata.section_title || 'document';
    return `Source ${sourceTitle} (score: ${chunk.score.toFixed(2)}):\n${chunk.text}`;
  }
}

export type SourceMetadata = {
  id: string;
  fileId: string;
  filename: string;
  section: string;
  sourceLabel: string;
  snippet: string;
  score: number;
  metadata: ChunkMetadata;
};

function computeShouldSkip(args: {
  skipDistanceFilter: boolean;
  threshold: number | null;
  relevanceThreshold: number;
  hasDistance: boolean;
  distance: number;
}): boolean {
  if (args.skipDistanceFilter) return false;
  const effective = args.threshold ?? args.relevanceThreshold;
  if (effective == null) return false;
  if (args.hasDistance) return args.distance > effective;
  return args.distance < effective;
}

function uidForSource(source: RagSource): string {
  const chunkIndex = source.metadata.chunk_index ?? 0;
  const chunkScale = source.metadata.chunk_scale;
  if (chunkScale && chunkScale !== 'default') {
    return `${source.fileId}_${chunkScale}_${chunkIndex}`;
  }
  return `${source.fileId}_${chunkIndex}`;
}

function parseChunkIndex(raw: number | string | undefined | null): number {
  if (raw == null) return 0;
  const s = String(raw);
  const tail = s.includes('_') ? s.slice(s.lastIndexOf('_') + 1) : s;
  const n = parseInt(tail, 10);
  return Number.isFinite(n) ? n : 0;
}

function groupByFileAndScale(sources: RagSource[]): Map<string, RagSource[]> {
  const fileChunks = new Map<string, RagSource[]>();
  for (const source of sources) {
    const chunkScale = source.metadata.chunk_scale;
    const groupKey =
      !chunkScale || chunkScale === 'default'
        ? source.fileId
        : `${source.fileId}_${chunkScale}`;
    const existing = fileChunks.get(groupKey);
    if (existing) existing.push(source);
    else fileChunks.set(groupKey, [source]);
  }
  return fileChunks;
}

function collectAdjacentUids(
  fileChunks: Map<string, RagSource[]>,
  window: number,
): string[] {
  const uids: string[] = [];
  for (const [groupKey, fileSources] of fileChunks) {
    const { fileId, chunkScale } = splitGroupKey(groupKey, fileSources);
    const indices = fileSources.map((s) => parseChunkIndex(s.metadata.chunk_index));

    let hashPrefix: string | null = null;
    for (const s of fileSources) {
      const chunkId = s.metadata._chunk_id;
      if (typeof chunkId === 'string' && chunkId) {
        const h = extractReuploadHash(chunkId, fileId);
        if (h) {
          hashPrefix = h;
          break;
        }
      }
    }

    for (const chunkIndex of indices) {
      const startIdx = Math.max(0, chunkIndex - window);
      const endIdx = chunkIndex + window;
      for (let idx = startIdx; idx <= endIdx; idx++) {
        if (hashPrefix) {
          uids.push(`${fileId}_${hashPrefix}_${chunkScale}_${idx}`);
        } else if (chunkScale !== 'default') {
          uids.push(`${fileId}_${chunkScale}_${idx}`);
        } else {
          uids.push(`${fileId}_${idx}`);
        }
      }
    }
  }
  return uids;
}

function splitGroupKey(
  groupKey: string,
  fileSources: RagSource[],
): { fileId: string; chunkScale: string } {
  const firstScale = fileSources[0]?.metadata.chunk_scale;
  if (firstScale && firstScale !== 'default') {
    const suffix = `_${firstScale}`;
    if (groupKey.endsWith(suffix)) {
      return { fileId: groupKey.slice(0, -suffix.length), chunkScale: String(firstScale) };
    }
  }
  return { fileId: groupKey, chunkScale: 'default' };
}

function sortByFileRankAndIndex(sources: RagSource[]): RagSource[] {
  const fileRank = new Map<string, number>();
  for (let pos = 0; pos < sources.length; pos++) {
    const fid = sources[pos].fileId;
    if (!fileRank.has(fid)) fileRank.set(fid, pos);
  }
  return [...sources].sort((a, b) => {
    const ra = fileRank.get(a.fileId) ?? 999;
    const rb = fileRank.get(b.fileId) ?? 999;
    if (ra !== rb) return ra - rb;
    if (a.fileId !== b.fileId) return a.fileId.localeCompare(b.fileId);
    return parseChunkIndex(a.metadata.chunk_index) - parseChunkIndex(b.metadata.chunk_index);
  });
}
