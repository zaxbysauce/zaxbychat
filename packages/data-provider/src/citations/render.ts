import type { CitationSource, InlineAnchor } from '../types/sources';

export interface PlainChunk {
  kind: 'text';
  text: string;
}

export interface AnchorChunk {
  kind: 'anchor';
  /** The literal text of the marker as it appeared (e.g. "[1]"). */
  text: string;
  source: CitationSource;
  anchor: InlineAnchor;
}

export type TextChunk = PlainChunk | AnchorChunk;

/**
 * Splits a message's assistant text into an ordered list of plain-text and
 * anchor chunks. Renderers walk the result and emit `[n]` markers as
 * clickable source pills while preserving surrounding text verbatim.
 *
 * Pure function. Uses the persisted `InlineAnchor.range` tuple as the
 * authoritative splice positions (server-side anchor parsing wrote the
 * exact char offsets). When an anchor's range is missing or invalid, the
 * anchor is silently skipped rather than guessed — preserves the "no
 * fabricated anchors" rule from §D-P5-2.
 */
export function buildTextChunks(params: {
  text: string;
  sources: ReadonlyArray<CitationSource>;
  anchors: ReadonlyArray<InlineAnchor>;
}): TextChunk[] {
  const { text, sources, anchors } = params;
  if (!text || text.length === 0) {
    return [];
  }
  if (!anchors || anchors.length === 0) {
    return [{ kind: 'text', text }];
  }

  const sourceById = new Map<string, CitationSource>();
  for (const s of sources) {
    sourceById.set(s.id, s);
  }

  const ordered = [...anchors]
    .filter((a) => a.range != null && a.range[0] >= 0 && a.range[1] <= text.length && a.range[0] < a.range[1])
    .filter((a) => sourceById.has(a.sourceId))
    .sort((a, b) => (a.range![0] ?? 0) - (b.range![0] ?? 0));

  if (ordered.length === 0) {
    return [{ kind: 'text', text }];
  }

  const chunks: TextChunk[] = [];
  let cursor = 0;
  for (const anchor of ordered) {
    const [start, end] = anchor.range!;
    if (start < cursor) {
      continue;
    }
    if (start > cursor) {
      chunks.push({ kind: 'text', text: text.slice(cursor, start) });
    }
    const source = sourceById.get(anchor.sourceId)!;
    chunks.push({
      kind: 'anchor',
      text: text.slice(start, end),
      source,
      anchor,
    });
    cursor = end;
  }
  if (cursor < text.length) {
    chunks.push({ kind: 'text', text: text.slice(cursor) });
  }
  return chunks;
}
