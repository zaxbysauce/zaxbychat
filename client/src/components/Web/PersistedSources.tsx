import React from 'react';
import { ExternalLink, FileText } from 'lucide-react';
import type { CitationSource } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

interface PersistedSourcesProps {
  sources?: CitationSource[];
  /** Set of source ids that the assistant actually cited inline. */
  citedIds?: Set<string>;
  className?: string;
}

/**
 * Phase 5 §D-P5-4 persisted sources panel. Renders `message.sources` —
 * the authoritative list of what was retrieved for this turn. Survives
 * browser refresh and conversation sharing; complements the existing
 * live-session Sources.tsx panel which reads from ephemeral context.
 *
 * When `citedIds` is provided, sources that were actually cited inline
 * are visually distinguished from sources that were merely retrieved but
 * not cited — honest about the distinction between "retrieved" and
 * "cited" (§D-P5-4).
 *
 * Returns null when there are no persisted sources so pre-Phase-5
 * messages render unchanged.
 */
export default function PersistedSources({
  sources,
  citedIds,
  className,
}: PersistedSourcesProps) {
  const localize = useLocalize();
  if (!sources || sources.length === 0) {
    return null;
  }

  return (
    <section
      className={cn(
        'mt-3 rounded-lg border border-border-light bg-surface-secondary p-3 text-xs',
        className,
      )}
      aria-label={localize('com_ui_sources_panel_title')}
    >
      <header className="mb-2 flex items-center gap-2 font-semibold">
        <span>{localize('com_ui_sources_panel_title')}</span>
        <span className="text-text-tertiary">{sources.length}</span>
      </header>
      <ol className="space-y-1.5">
        {sources.map((source, i) => {
          const wasCited = citedIds?.has(source.id) ?? false;
          return (
            <li key={source.id} className="flex gap-2">
              <span className={cn('shrink-0 font-mono', wasCited ? 'text-text-primary' : 'text-text-tertiary')}>
                [{i + 1}]
              </span>
              <SourceRow source={source} wasCited={wasCited} />
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function SourceRow({ source, wasCited }: { source: CitationSource; wasCited: boolean }) {
  const localize = useLocalize();
  const cited = wasCited ? (
    <span className="ml-2 text-[10px] text-surface-submit">
      {localize('com_ui_sources_cited')}
    </span>
  ) : null;

  if (source.kind === 'web' && source.url) {
    const domain = source.kindSpecific.kind === 'web' ? source.kindSpecific.domain : undefined;
    return (
      <span className="min-w-0 flex-1 break-words">
        <a
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-start gap-1 text-text-secondary hover:text-text-primary hover:underline"
        >
          <span className="line-clamp-2">{source.title || source.url}</span>
          <ExternalLink className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
        </a>
        {domain && <span className="ml-1 text-text-tertiary">· {domain}</span>}
        {cited}
      </span>
    );
  }

  if (source.kind === 'file' && source.kindSpecific.kind === 'file') {
    const pages = source.kindSpecific.pages?.length
      ? localize('com_ui_sources_file_pages', { 0: source.kindSpecific.pages.join(', ') })
      : '';
    return (
      <span className="min-w-0 flex-1 break-words">
        <FileText className="mr-1 inline size-3" aria-hidden="true" />
        <span>{source.kindSpecific.fileName}</span>
        {pages && <span className="ml-1 text-text-tertiary">· {pages}</span>}
        {cited}
      </span>
    );
  }

  return (
    <span className="min-w-0 flex-1 break-words text-text-secondary">
      <span>{source.title || source.id}</span>
      <span className="ml-1 text-text-tertiary">· {source.kind}</span>
      {cited}
    </span>
  );
}
