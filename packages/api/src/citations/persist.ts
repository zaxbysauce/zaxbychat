import {
  citationSourceSchema,
  citationSourcesArraySchema,
  inlineAnchorsArraySchema,
  normalizeFileResults,
  normalizeWebResults,
  parseInlineAnchors,
} from 'librechat-data-provider';
import type {
  CitationSource,
  InlineAnchor,
  LegAttribution,
  NormalizationFailure,
} from 'librechat-data-provider';

/**
 * Server-side citation persistence helpers (Phase 5 PR 5.1 §D-P5-3).
 * Server is the single source of truth: ingest raw web/file tool outputs
 * here, validate via the contract, accumulate per-message, then persist
 * onto `TMessage.sources` via the same path other message updates use.
 *
 * No I/O — these are pure-function helpers a route/handler composes with
 * existing message-save machinery.
 */

export interface IngestWebResultsParams {
  messageId: string;
  rawResults: ReadonlyArray<{
    link?: string;
    title?: string;
    snippet?: string;
    date?: string;
    domain?: string;
    score?: number;
  }>;
  provider: string;
  legAttribution?: LegAttribution;
  /** Caller's "now" — overridable for deterministic tests. */
  fetchedAt?: string;
  /**
   * Sources already attached to this message in earlier ingest events
   * (e.g. an earlier tool call in the same turn). New sources are appended;
   * the returned `nextSources` is the caller's input for the next ingest.
   */
  existingSources?: ReadonlyArray<CitationSource>;
}

export interface IngestFileResultsParams {
  messageId: string;
  rawResults: ReadonlyArray<{
    fileId?: string;
    fileName?: string;
    pages?: number[];
    relevance?: number;
    fileType?: string;
    snippet?: string;
  }>;
  provider: string;
  legAttribution?: LegAttribution;
  existingSources?: ReadonlyArray<CitationSource>;
}

export interface IngestResult {
  /** The full updated source list, ready to persist. */
  nextSources: CitationSource[];
  /** Just the new sources from this ingest, for logging or downstream use. */
  added: CitationSource[];
  /** Indices in the raw input that failed validation. */
  failures: Array<{ index: number; failure: NormalizationFailure }>;
}

export function ingestWebResults(params: IngestWebResultsParams): IngestResult {
  const indexBase = params.existingSources?.length ?? 0;
  const idPrefix = `${params.messageId}:${indexBase}`;
  const { sources, failures } = normalizeWebResults(params.rawResults, {
    idPrefix,
    provider: params.provider,
    fetchedAt: params.fetchedAt,
    ...(params.legAttribution ? { legAttribution: params.legAttribution } : {}),
  });
  const nextSources = mergeSources(params.existingSources ?? [], sources);
  return { nextSources, added: sources, failures };
}

export function ingestFileResults(params: IngestFileResultsParams): IngestResult {
  const indexBase = params.existingSources?.length ?? 0;
  const idPrefix = `${params.messageId}:${indexBase}`;
  const { sources, failures } = normalizeFileResults(params.rawResults, {
    idPrefix,
    provider: params.provider,
    ...(params.legAttribution ? { legAttribution: params.legAttribution } : {}),
  });
  const nextSources = mergeSources(params.existingSources ?? [], sources);
  return { nextSources, added: sources, failures };
}

/**
 * Final-pass anchor extraction: called once per assistant turn after the
 * stream completes. Reads the model's accumulated text + the persisted
 * sources, parses any `[n]` markers, and returns the resulting
 * `InlineAnchor[]` to persist alongside.
 *
 * Honest behavior (§D-P5-2): no markers → no anchors. Out-of-range
 * markers are dropped + reported via `unknownMarkers`.
 */
export function extractAnchorsForPersistence(
  text: string,
  sources: ReadonlyArray<CitationSource>,
): { anchors: InlineAnchor[]; unknownMarkers: number[] } {
  return parseInlineAnchors(text, sources);
}

/**
 * Validates that a `sources[]` snapshot complies with the persisted
 * contract. Used by the message save path to refuse malformed writes.
 * Returns the parsed (validated) array on success; throws otherwise so
 * the save path's existing error handling can reject the write.
 */
export function validateSourcesForPersistence(
  candidate: ReadonlyArray<unknown>,
): CitationSource[] {
  return citationSourcesArraySchema.parse(candidate);
}

export function validateAnchorsForPersistence(
  candidate: ReadonlyArray<unknown>,
): InlineAnchor[] {
  return inlineAnchorsArraySchema.parse(candidate);
}

export function isValidCitationSource(candidate: unknown): boolean {
  return citationSourceSchema.safeParse(candidate).success;
}

/**
 * De-duplicates incoming sources against the existing list by `id`. A
 * second call for the same id keeps the existing entry (sources are
 * stable; later ingest events refine the trailing tool call, not the
 * earlier ones).
 */
function mergeSources(
  existing: ReadonlyArray<CitationSource>,
  incoming: ReadonlyArray<CitationSource>,
): CitationSource[] {
  const seen = new Set<string>();
  const merged: CitationSource[] = [];
  for (const s of existing) {
    if (seen.has(s.id)) {
      continue;
    }
    seen.add(s.id);
    merged.push(s);
  }
  for (const s of incoming) {
    if (seen.has(s.id)) {
      continue;
    }
    seen.add(s.id);
    merged.push(s);
  }
  return merged;
}
