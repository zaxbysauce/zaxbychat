import type { CitationSource, InlineAnchor } from '../types/sources';

/**
 * Parses `[n]` markers from assistant text into honest `InlineAnchor[]`
 * (Phase 5 §D-P5-2). One-indexed; n ∈ [1, sources.length].
 *
 * The contract:
 *   - The assistant was prompted to use `[n]` to cite source n.
 *   - We anchor ONLY markers that actually appear and that point to a valid
 *     source index. Out-of-range / malformed markers are dropped silently.
 *   - We never invent anchors. If the assistant did not cite, this returns
 *     `[]` and the rendered message has no inline anchors.
 *   - Anchor `range` records the marker's char position in the ORIGINAL
 *     text (the literal `[n]` substring). Renderers use the range to swap
 *     the marker for an anchored span without changing surrounding text.
 *   - `sourceId` references `CitationSource.id` (stable within the
 *     persisted message) — not transient array positions.
 */
export interface ParseAnchorsResult {
  anchors: InlineAnchor[];
  /** Set of (1-indexed) marker numbers seen but unmapped (out-of-range). */
  unknownMarkers: number[];
}

const MARKER_PATTERN = /\[(\d+)\]/g;

export function parseInlineAnchors(
  text: string,
  sources: ReadonlyArray<CitationSource>,
): ParseAnchorsResult {
  if (typeof text !== 'string' || text.length === 0 || sources.length === 0) {
    return { anchors: [], unknownMarkers: [] };
  }

  const anchors: InlineAnchor[] = [];
  const unknownMarkers: number[] = [];
  const seenUnknown = new Set<number>();

  MARKER_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MARKER_PATTERN.exec(text)) !== null) {
    const oneIndexed = parseInt(match[1], 10);
    if (!Number.isFinite(oneIndexed) || oneIndexed < 1 || oneIndexed > sources.length) {
      if (Number.isFinite(oneIndexed) && !seenUnknown.has(oneIndexed)) {
        seenUnknown.add(oneIndexed);
        unknownMarkers.push(oneIndexed);
      }
      continue;
    }
    const source = sources[oneIndexed - 1];
    const start = match.index;
    const end = start + match[0].length;
    anchors.push({ sourceId: source.id, range: [start, end] });
  }

  return { anchors, unknownMarkers };
}

/**
 * Returns the set of CitationSource ids that the assistant actually cited
 * inline. Useful for the "sources actually cited inline" affordance vs.
 * the broader "retrieved sources" panel (§D-P5-4).
 */
export function citedSourceIds(anchors: ReadonlyArray<InlineAnchor>): Set<string> {
  const out = new Set<string>();
  for (const a of anchors) {
    out.add(a.sourceId);
  }
  return out;
}
