import React, { memo, useState } from 'react';
import { Github } from 'lucide-react';
import { TooltipAnchor } from '@librechat/client';
import { useRecoilState } from 'recoil';
import { useGithubFirstClassEnabled, useGithubMcpServers } from '~/hooks/MCP/useGithubFirstClass';
import { githubContextSelectionState } from '~/store/githubContext';
import GitHubContextDialog from './GitHubContextDialog';
import GitHubContextChip from './GitHubContextChip';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/**
 * Phase 7 PR 7.2 — composer entry point for the GitHub context picker.
 *
 * Sibling of `<MCPSelect />` in the chat input badge row. Visibility
 * is gated on:
 *   - `githubFirstClassEnabled` mirrored from startup config (default-off);
 *   - at least one MCP server with `kind: 'github'` configured.
 *
 * When both conditions are met, renders a small button + (when set)
 * the selected-context chip. Clicking opens the modal picker.
 */
function GitHubContextButton() {
  const localize = useLocalize();
  const enabled = useGithubFirstClassEnabled();
  const githubServers = useGithubMcpServers();
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useRecoilState(githubContextSelectionState);

  if (!enabled || githubServers.length === 0) return null;

  return (
    <>
      <TooltipAnchor
        description={localize('com_ui_github_context')}
        render={
          <button
            type="button"
            aria-label={localize('com_ui_github_context')}
            onClick={() => setOpen(true)}
            data-testid="github-context-button"
            className={cn(
              'inline-flex h-7 items-center gap-1 rounded border border-border-light px-2 text-xs',
              'hover:bg-surface-tertiary',
              selection ? 'bg-surface-tertiary' : '',
            )}
          >
            <Github size={14} aria-hidden />
            <span>{localize('com_ui_github_context')}</span>
          </button>
        }
      />
      {selection && (
        <GitHubContextChip
          selection={selection}
          onClear={() => setSelection(null)}
        />
      )}
      <GitHubContextDialog
        open={open}
        onOpenChange={setOpen}
        onSelect={(next) => setSelection(next)}
      />
    </>
  );
}

export default memo(GitHubContextButton);
