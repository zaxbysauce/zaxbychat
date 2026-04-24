import React from 'react';
import type { CitationSource } from 'librechat-data-provider';
import { useMessageContext } from '~/Providers';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

interface InlineSourceAnchorProps {
  sourceId?: string;
  marker?: string;
  node?: {
    properties?: { sourceId?: string; marker?: string };
  };
  children?: React.ReactNode;
}

/**
 * Phase 5 PR 5.2 inline citation pill (§D-P5-4). Renders a clickable
 * reference marker that opens the Source's URL (web) or scrolls to the
 * Sources panel entry (file). Honest rendering: only emitted for `[n]`
 * markers the server validated as InlineAnchors on the message.
 *
 * This complements — does not replace — the existing bottom Sources panel.
 * The panel lists all retrieved sources; inline anchors highlight the
 * specific claims the model chose to cite.
 */
export default function InlineSourceAnchor(props: InlineSourceAnchorProps) {
  const localize = useLocalize();
  const { sources } = useMessageContext();
  const sourceId = props.sourceId ?? props.node?.properties?.sourceId ?? '';
  const marker = props.marker ?? props.node?.properties?.marker ?? '';

  const source: CitationSource | undefined = React.useMemo(() => {
    if (!sources || sources.length === 0 || !sourceId) {
      return undefined;
    }
    return sources.find((s) => s.id === sourceId);
  }, [sources, sourceId]);

  if (!source) {
    return <span>{marker || props.children}</span>;
  }

  const href = source.kind === 'web' && source.url ? source.url : undefined;
  const labelBase = source.title || marker || source.id;
  const ariaLabel = localize('com_ui_citation_inline_label', {
    0: marker,
    1: labelBase,
  });

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title={source.title}
        aria-label={ariaLabel}
        className={cn(
          'mx-0.5 inline-flex items-center rounded border border-border-light',
          'bg-surface-tertiary px-1 py-0 text-[10px] font-medium text-text-secondary',
          'align-super no-underline hover:bg-surface-hover hover:text-text-primary',
        )}
      >
        {marker}
      </a>
    );
  }

  return (
    <span
      title={source.title}
      aria-label={ariaLabel}
      className={cn(
        'mx-0.5 inline-flex items-center rounded border border-border-light',
        'bg-surface-tertiary px-1 py-0 text-[10px] font-medium text-text-secondary',
        'align-super',
      )}
    >
      {marker}
    </span>
  );
}
