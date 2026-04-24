/**
 * Phase 6 — shared retrieval types.
 *
 * Port surface: donor ragappv3 `backend/app/services/document_retrieval.py`
 * (`RAGSource` dataclass, lines 102-112) and related chunk shapes used by
 * `prompt_builder.py`, `fusion.py`.
 *
 * Port-only: these types describe inputs to retrieval utilities. They are
 * not wired into any call site in this phase.
 */

export type ChunkMetadata = {
  source_file?: string;
  filename?: string;
  section_title?: string;
  heading?: string;
  chunk_index?: number | string;
  chunk_scale?: string | null;
  raw_text?: string;
  _chunk_id?: string;
  [key: string]: string | number | boolean | null | undefined;
};

/**
 * Donor equivalent: `RAGSource` dataclass at
 * document_retrieval.py:102-112. `parent_window_text` is the parent-document
 * retrieval window (Issue #12) and is optional.
 */
export type RagSource = {
  text: string;
  fileId: string;
  score: number;
  metadata: ChunkMetadata;
  parentWindowText?: string;
};

/**
 * Raw vector-store record shape the donor `filter_relevant` consumes
 * (document_retrieval.py:146-261). `_distance` (lower better) or `score`
 * (higher better) is the relevance signal; `_rerank_score` is the
 * sigmoid-normalized reranker score when present.
 */
export type RetrievalRecord = {
  id?: string;
  file_id?: string;
  text?: string;
  score?: number;
  _distance?: number;
  _rerank_score?: number;
  metadata?: ChunkMetadata | string | null;
};

/**
 * Optional adapter the donor `expand_window` path requires. Zaxbychat has
 * no vector store today; when no adapter is injected, `expandWindow`
 * returns its input unchanged. Interface only — no default implementation.
 */
export type VectorStoreAdapter = {
  getChunksByUid(uids: string[]): Promise<RetrievalRecord[]>;
};

/**
 * Port-local memory record shape consumed by `PromptBuilder`. The donor
 * `prompt_builder.py:build_messages` accepts `memories: List[MemoryRecord]`
 * with `.key`, `.value`, optional `.created_at`. Zaxbychat's own memory
 * module uses different types; keeping this port-local avoids coupling.
 */
export type MemoryRecord = {
  key: string;
  value: string;
  createdAt?: string;
};
