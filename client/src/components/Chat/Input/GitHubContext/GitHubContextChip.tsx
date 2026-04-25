import React, { memo, useMemo } from 'react';
import { X } from 'lucide-react';
import type { GithubContextSelection } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

interface Props {
  selection: GithubContextSelection;
  onClear: () => void;
}

/**
 * Phase 7 PR 7.2 — chip surfacing the currently attached GitHub
 * context next to the input badge row. Clicking the `×` clears the
 * Recoil atom; the chip disappears immediately.
 */
function GitHubContextChip({ selection, onClear }: Props) {
  const localize = useLocalize();
  const label = useMemo(() => formatChipLabel(selection), [selection]);
  return (
    <span
      data-testid="github-context-chip"
      className={cn(
        'inline-flex h-7 max-w-[24ch] items-center gap-1 rounded-full border border-border-light bg-surface-tertiary px-2 text-xs',
        'truncate',
      )}
      title={label}
      aria-label={`${localize('com_ui_github_context_attached_chip')}: ${label}`}
    >
      <span className="truncate">{label}</span>
      <button
        type="button"
        className="ml-1 rounded-full p-0.5 hover:bg-surface-active"
        aria-label={localize('com_ui_github_context_remove')}
        onClick={onClear}
        data-testid="github-context-chip-remove"
      >
        <X size={12} aria-hidden />
      </button>
    </span>
  );
}

function formatChipLabel(selection: GithubContextSelection): string {
  const parts: string[] = [selection.repo];
  if (selection.itemType === 'file' && selection.path) {
    parts.push(`:${selection.path}`);
    if (
      typeof selection.lineStart === 'number' &&
      typeof selection.lineEnd === 'number'
    ) {
      parts.push(`#L${selection.lineStart}-L${selection.lineEnd}`);
    } else if (typeof selection.lineStart === 'number') {
      parts.push(`#L${selection.lineStart}`);
    }
  } else if (selection.itemType && selection.itemId) {
    parts.push(` ${selection.itemType} #${selection.itemId}`);
  }
  return parts.join('');
}

export default memo(GitHubContextChip);
