import { visit, SKIP } from 'unist-util-visit';
import type { Node } from 'unist';
import type { CitationSource, InlineAnchor } from 'librechat-data-provider';

interface ParentNode extends Node {
  children: Node[];
}

interface TextNode extends Node {
  type: 'text';
  value: string;
}

interface SourceAnchorNode extends Node {
  type: 'sourceAnchor';
  data: {
    hName: 'source-anchor';
    hProperties: {
      sourceId: string;
      marker: string;
    };
  };
}

/**
 * Phase 5 PR 5.2 remark plugin. Transforms `[n]` text patterns into
 * `source-anchor` AST nodes when:
 *   - inlineAnchors contains an anchor whose sourceId maps to a source in sources
 *   - the marker's index maps to a valid 1-indexed source position
 *
 * Out-of-range markers are left as literal text (no fabricated anchors).
 * Uses the persisted `inlineAnchors` as the authoritative set of
 * "which markers were validated server-side" — anchors without ranges are
 * still honored (fall back to 1-indexed lookup).
 *
 * The plugin is parameterized so Markdown.tsx can call it with per-message
 * data without introducing a global.
 */
export function sourceAnchorPlugin(options: {
  sources?: ReadonlyArray<CitationSource>;
  inlineAnchors?: ReadonlyArray<InlineAnchor>;
}) {
  return () => (tree: Node) => {
    const sources = options.sources ?? [];
    const anchors = options.inlineAnchors ?? [];
    if (sources.length === 0 || anchors.length === 0) {
      return;
    }

    const validSourceIds = new Set(sources.map((s) => s.id));
    const hasValidAnchor = anchors.some((a) => validSourceIds.has(a.sourceId));
    if (!hasValidAnchor) {
      return;
    }

    const markerPattern = /\[(\d+)\]/g;

    visit(tree, 'text', (node: TextNode, index, parent: ParentNode | null) => {
      if (!parent || typeof index !== 'number' || typeof node.value !== 'string') {
        return;
      }
      const text = node.value;
      const matches: Array<{ start: number; end: number; n: number }> = [];
      markerPattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = markerPattern.exec(text)) !== null) {
        const n = parseInt(m[1], 10);
        if (!Number.isFinite(n) || n < 1 || n > sources.length) {
          continue;
        }
        matches.push({ start: m.index, end: m.index + m[0].length, n });
      }
      if (matches.length === 0) {
        return;
      }

      const newChildren: Node[] = [];
      let cursor = 0;
      for (const mm of matches) {
        if (mm.start > cursor) {
          newChildren.push({ type: 'text', value: text.slice(cursor, mm.start) } as TextNode);
        }
        const source = sources[mm.n - 1];
        const anchorNode: SourceAnchorNode = {
          type: 'sourceAnchor',
          data: {
            hName: 'source-anchor',
            hProperties: {
              sourceId: source.id,
              marker: text.slice(mm.start, mm.end),
            },
          },
        };
        newChildren.push(anchorNode);
        cursor = mm.end;
      }
      if (cursor < text.length) {
        newChildren.push({ type: 'text', value: text.slice(cursor) } as TextNode);
      }

      parent.children.splice(index, 1, ...newChildren);
      return [SKIP, index + newChildren.length];
    });
  };
}
