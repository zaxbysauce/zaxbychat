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

/**
 * Raw GitHub source produced by `packages/api/src/mcp/github` per-tool
 * parsers. Phase 7 PR 7.1 §D-P7-2.
 *
 * `repo` is required — it is the only field GitHub MCP tool outputs are
 * guaranteed to carry across all citation-emitting tool shapes, and we
 * don't fabricate repo identity. `itemType` + `itemId` discriminate the
 * concrete object the citation points at; tool-specific helpers fill
 * them as the payload allows.
 */
export interface RawGithubResult {
  repo: string;
  ref?: string;
  path?: string;
  lineStart?: number;
  lineEnd?: number;
  itemType?: 'repo' | 'file' | 'pr' | 'issue' | 'commit';
  itemId?: string;
  title?: string;
  url?: string;
  snippet?: string;
  score?: number;
}

/**
 * Converts a single raw GitHub-MCP result into a normalized
 * `CitationSource` (kind: 'github'). Returns failure when the required
 * `repo` is missing — we don't fabricate repo identity. Honest-shape:
 * when `lineStart/lineEnd` are inconsistent or `itemType` doesn't match
 * the rest of the shape, the helper returns failure rather than
 * normalizing to a guess.
 */
export function toGithubCitationSource(
  raw: RawGithubResult,
  index: number,
  options: NormalizationOptions,
): NormalizationResult {
  if (!raw || typeof raw.repo !== 'string' || raw.repo.length === 0) {
    return {
      ok: false,
      failure: {
        reason: 'missing_required_field',
        details: 'repo is required for github sources',
      },
    };
  }

  if (
    typeof raw.lineStart === 'number' &&
    typeof raw.lineEnd === 'number' &&
    raw.lineStart > raw.lineEnd
  ) {
    return {
      ok: false,
      failure: {
        reason: 'invalid_field',
        details: `lineStart (${raw.lineStart}) must be <= lineEnd (${raw.lineEnd})`,
      },
    };
  }

  const title =
    typeof raw.title === 'string' && raw.title.length > 0
      ? raw.title
      : deriveGithubTitle(raw);

  const candidate: CitationSource = {
    id: `${options.idPrefix}:github:${index}`,
    kind: 'github',
    title,
    url: typeof raw.url === 'string' && raw.url.length > 0 ? raw.url : undefined,
    snippet: typeof raw.snippet === 'string' ? raw.snippet : undefined,
    score: typeof raw.score === 'number' ? raw.score : undefined,
    provider: options.provider,
    ...(options.legAttribution ? { legAttribution: options.legAttribution } : {}),
    kindSpecific: {
      kind: 'github',
      repo: raw.repo,
      ...(typeof raw.ref === 'string' && raw.ref.length > 0 ? { ref: raw.ref } : {}),
      ...(typeof raw.path === 'string' && raw.path.length > 0 ? { path: raw.path } : {}),
      ...(typeof raw.lineStart === 'number' ? { lineStart: raw.lineStart } : {}),
      ...(typeof raw.lineEnd === 'number' ? { lineEnd: raw.lineEnd } : {}),
      ...(raw.itemType ? { itemType: raw.itemType } : {}),
      ...(typeof raw.itemId === 'string' && raw.itemId.length > 0 ? { itemId: raw.itemId } : {}),
    },
  };

  const parsed = citationSourceSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      failure: {
        reason: 'invalid_field',
        details: parsed.error.issues.map((i) => i.message).join('; '),
      },
    };
  }
  return { ok: true, source: parsed.data };
}

export function normalizeGithubResults(
  rawResults: ReadonlyArray<RawGithubResult>,
  options: NormalizationOptions,
): { sources: CitationSource[]; failures: Array<{ index: number; failure: NormalizationFailure }> } {
  const sources: CitationSource[] = [];
  const failures: Array<{ index: number; failure: NormalizationFailure }> = [];
  for (let i = 0; i < rawResults.length; i++) {
    const result = toGithubCitationSource(rawResults[i], i, options);
    if (result.ok) {
      sources.push(result.source);
    } else {
      failures.push({ index: i, failure: result.failure });
    }
  }
  return { sources, failures };
}

function deriveGithubTitle(raw: RawGithubResult): string {
  if (raw.path) return `${raw.repo}:${raw.path}`;
  if (raw.itemType && raw.itemId) return `${raw.repo} ${raw.itemType} #${raw.itemId}`;
  return raw.repo;
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
