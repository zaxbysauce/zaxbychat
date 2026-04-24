import { citationSourceSchema } from '../types/sources';
import type { CitationSource, LegAttribution } from '../types/sources';

/**
 * Honest-shape normalization helpers (Phase 5 §D-P5-3): convert raw outputs
 * from web-search and file-retrieval tool runs into the binding
 * `CitationSource` contract. Pure functions; no I/O.
 *
 * Server is the source of truth: callers run these at SSE-attachment ingest
 * time, validate via `citationSourceSchema`, persist on `TMessage.sources`.
 *
 * No heuristic guessing: missing fields stay missing on `CitationSource`
 * rather than being fabricated. Legitimate ambiguity is reported via the
 * helper return shape so callers can log and skip.
 */

export interface NormalizationOptions {
  /** Stable id prefix; helpers append a deterministic suffix. */
  idPrefix: string;
  /** Citation provider (e.g. 'serper', 'rag_api'). */
  provider: string;
  /** Optional council leg attribution to thread through. */
  legAttribution?: LegAttribution;
  /** ISO8601 timestamp; defaults to caller's "now". */
  fetchedAt?: string;
}

export interface NormalizationFailure {
  reason: 'missing_required_field' | 'invalid_field' | 'unknown';
  details: string;
}

export type NormalizationResult =
  | { ok: true; source: CitationSource }
  | { ok: false; failure: NormalizationFailure };

interface RawWebResult {
  link?: string;
  title?: string;
  snippet?: string;
  date?: string;
  domain?: string;
  position?: number;
  score?: number;
  attribution?: string;
}

/**
 * Converts a single raw web-search organic/topStory/reference into a
 * normalized `CitationSource` (kind: 'web'). Returns failure when the
 * required `link` is missing (we never fabricate URLs).
 */
export function toWebCitationSource(
  raw: RawWebResult,
  index: number,
  options: NormalizationOptions,
): NormalizationResult {
  if (!raw || typeof raw.link !== 'string' || raw.link.length === 0) {
    return {
      ok: false,
      failure: { reason: 'missing_required_field', details: 'link is required for web sources' },
    };
  }

  const domain = typeof raw.domain === 'string' && raw.domain.length > 0
    ? raw.domain
    : extractDomain(raw.link);
  if (!domain) {
    return {
      ok: false,
      failure: { reason: 'invalid_field', details: `unable to derive domain from "${raw.link}"` },
    };
  }

  const fetchedAt = options.fetchedAt ?? new Date().toISOString();

  const candidate: CitationSource = {
    id: `${options.idPrefix}:web:${index}`,
    kind: 'web',
    title: typeof raw.title === 'string' && raw.title.length > 0 ? raw.title : raw.link,
    url: raw.link,
    snippet: typeof raw.snippet === 'string' ? raw.snippet : undefined,
    score: typeof raw.score === 'number' ? raw.score : undefined,
    provider: options.provider,
    ...(options.legAttribution ? { legAttribution: options.legAttribution } : {}),
    kindSpecific: {
      kind: 'web',
      domain,
      ...(typeof raw.date === 'string' && raw.date.length > 0 ? { publishedAt: raw.date } : {}),
      fetchedAt,
    },
  };

  const parsed = citationSourceSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      failure: { reason: 'invalid_field', details: parsed.error.issues.map((i) => i.message).join('; ') },
    };
  }
  return { ok: true, source: parsed.data };
}

interface RawFileResult {
  fileId?: string;
  fileName?: string;
  pages?: number[];
  pageRelevance?: Record<string, number>;
  relevance?: number;
  fileType?: string;
  metadata?: { storageType?: string };
  snippet?: string;
}

/**
 * Converts a single raw file-search result into a normalized
 * `CitationSource` (kind: 'file'). Requires both `fileId` and `fileName`
 * — we don't fabricate file identities.
 */
export function toFileCitationSource(
  raw: RawFileResult,
  index: number,
  options: NormalizationOptions,
): NormalizationResult {
  if (!raw || typeof raw.fileId !== 'string' || raw.fileId.length === 0) {
    return {
      ok: false,
      failure: { reason: 'missing_required_field', details: 'fileId is required for file sources' },
    };
  }
  if (typeof raw.fileName !== 'string' || raw.fileName.length === 0) {
    return {
      ok: false,
      failure: { reason: 'missing_required_field', details: 'fileName is required for file sources' },
    };
  }

  const pages = Array.isArray(raw.pages) && raw.pages.length > 0 ? raw.pages : undefined;

  const candidate: CitationSource = {
    id: `${options.idPrefix}:file:${index}`,
    kind: 'file',
    title: raw.fileName,
    snippet: typeof raw.snippet === 'string' ? raw.snippet : undefined,
    score: typeof raw.relevance === 'number' ? raw.relevance : undefined,
    provider: options.provider,
    ...(options.legAttribution ? { legAttribution: options.legAttribution } : {}),
    kindSpecific: {
      kind: 'file',
      fileId: raw.fileId,
      fileName: raw.fileName,
      ...(pages ? { pages } : {}),
      ...(typeof raw.fileType === 'string' && raw.fileType.length > 0
        ? { fileType: raw.fileType }
        : {}),
    },
  };

  const parsed = citationSourceSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      failure: { reason: 'invalid_field', details: parsed.error.issues.map((i) => i.message).join('; ') },
    };
  }
  return { ok: true, source: parsed.data };
}

/**
 * Batch wrapper: normalize an array of raw web results, dropping any that
 * fail validation. Returns the normalized list plus per-index failures so
 * callers can log them. Order is preserved for successful results.
 */
export function normalizeWebResults(
  rawResults: ReadonlyArray<RawWebResult>,
  options: NormalizationOptions,
): { sources: CitationSource[]; failures: Array<{ index: number; failure: NormalizationFailure }> } {
  const sources: CitationSource[] = [];
  const failures: Array<{ index: number; failure: NormalizationFailure }> = [];
  for (let i = 0; i < rawResults.length; i++) {
    const result = toWebCitationSource(rawResults[i], i, options);
    if (result.ok) {
      sources.push(result.source);
    } else {
      failures.push({ index: i, failure: result.failure });
    }
  }
  return { sources, failures };
}

export function normalizeFileResults(
  rawResults: ReadonlyArray<RawFileResult>,
  options: NormalizationOptions,
): { sources: CitationSource[]; failures: Array<{ index: number; failure: NormalizationFailure }> } {
  const sources: CitationSource[] = [];
  const failures: Array<{ index: number; failure: NormalizationFailure }> = [];
  for (let i = 0; i < rawResults.length; i++) {
    const result = toFileCitationSource(rawResults[i], i, options);
    if (result.ok) {
      sources.push(result.source);
    } else {
      failures.push({ index: i, failure: result.failure });
    }
  }
  return { sources, failures };
}

function extractDomain(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.hostname || null;
  } catch {
    const match = url.match(/^[a-z]+:\/\/([^/]+)/i);
    return match ? match[1] : null;
  }
}
