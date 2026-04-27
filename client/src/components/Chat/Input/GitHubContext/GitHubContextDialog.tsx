import React, { memo, useMemo, useState } from 'react';
import {
  Label,
  Input,
  Button,
  OGDialog,
  OGDialogTitle,
  OGDialogHeader,
  OGDialogFooter,
  OGDialogContent,
} from '@librechat/client';
import { githubContextSelectionSchema } from 'librechat-data-provider';
import type { GithubContextSelection, GithubContextItemType } from 'librechat-data-provider';
import { useGithubMcpServers } from '~/hooks/MCP/useGithubFirstClass';
import { useLocalize } from '~/hooks';
import type { TranslationKeys } from '~/hooks';

const KIND_OPTIONS: GithubContextItemType[] = ['file', 'pr', 'issue', 'commit', 'repo'];

const KIND_LABEL_KEYS: Record<GithubContextItemType, TranslationKeys> = {
  file: 'com_ui_github_context_kind_file',
  pr: 'com_ui_github_context_kind_pr',
  issue: 'com_ui_github_context_kind_issue',
  commit: 'com_ui_github_context_kind_commit',
  repo: 'com_ui_github_context_kind_repo',
};

const ID_LABEL_KEYS: Record<'pr' | 'issue' | 'commit', TranslationKeys> = {
  pr: 'com_ui_github_context_pr_id',
  issue: 'com_ui_github_context_issue_id',
  commit: 'com_ui_github_context_commit_id',
};

interface Props {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onSelect: (selection: GithubContextSelection) => void;
}

/**
 * Phase 7 PR 7.2 — modal picker for a single GitHub context attachment.
 *
 * Single-context only (D-P7-13 lock). Server picker + repo input +
 * one drill-down (file path / PR # / issue # / commit SHA / repo). The
 * picker calls no MCP tools itself in this MVP — it lets the user
 * type identifiers directly. Picker autocomplete via the
 * `useCallPickerTool` hook is deferred to a follow-up.
 */
function GitHubContextDialogContent({ open, onOpenChange, onSelect }: Props) {
  const localize = useLocalize();
  const githubServers = useGithubMcpServers();

  const [serverName, setServerName] = useState<string>(githubServers[0]?.serverName ?? '');
  const [repo, setRepo] = useState('');
  const [refValue, setRefValue] = useState('');
  const [itemType, setItemType] = useState<GithubContextItemType>('file');
  const [path, setPath] = useState('');
  const [itemId, setItemId] = useState('');
  const [lineStart, setLineStart] = useState('');
  const [lineEnd, setLineEnd] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const candidate = useMemo<Partial<GithubContextSelection>>(() => {
    const sel: Partial<GithubContextSelection> = { serverName, repo };
    if (refValue) sel.ref = refValue;
    sel.itemType = itemType;
    if (itemType === 'file') {
      if (path) sel.path = path;
      const ls = parseInt(lineStart, 10);
      const le = parseInt(lineEnd, 10);
      if (!Number.isNaN(ls) && ls > 0) sel.lineStart = ls;
      if (!Number.isNaN(le) && le > 0) sel.lineEnd = le;
    } else if (itemType === 'repo') {
      // repo only — itemId/path are intentionally omitted
    } else {
      if (itemId) sel.itemId = itemId;
    }
    return sel;
  }, [serverName, repo, refValue, itemType, path, itemId, lineStart, lineEnd]);

  const onAttach = () => {
    setValidationError(null);
    const result = githubContextSelectionSchema.safeParse(candidate);
    if (!result.success) {
      const first = result.error.issues[0];
      setValidationError(first?.message ?? 'Invalid selection');
      return;
    }
    onSelect(result.data as GithubContextSelection);
    onOpenChange(false);
    setRepo('');
    setRefValue('');
    setPath('');
    setItemId('');
    setLineStart('');
    setLineEnd('');
  };

  if (githubServers.length === 0) {
    return (
      <OGDialog open={open} onOpenChange={onOpenChange}>
        <OGDialogContent className="w-11/12 max-w-md">
          <OGDialogHeader>
            <OGDialogTitle>{localize('com_ui_github_context_select')}</OGDialogTitle>
          </OGDialogHeader>
          <p className="text-sm text-text-secondary">
            {localize('com_ui_github_context_no_servers')}
          </p>
          <OGDialogFooter>
            <Button onClick={() => onOpenChange(false)} variant="outline">
              {localize('com_ui_close')}
            </Button>
          </OGDialogFooter>
        </OGDialogContent>
      </OGDialog>
    );
  }

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogContent className="w-11/12 max-w-lg">
        <OGDialogHeader>
          <OGDialogTitle>{localize('com_ui_github_context_select')}</OGDialogTitle>
        </OGDialogHeader>
        <div className="flex flex-col gap-3 py-2">
          {githubServers.length > 1 && (
            <div>
              <Label htmlFor="github-context-server">
                {localize('com_ui_github_context_select_server')}
              </Label>
              <select
                id="github-context-server"
                aria-label={localize('com_ui_github_context_select_server')}
                value={serverName}
                onChange={(e) => setServerName(e.target.value)}
                className="block w-full rounded border border-border-light bg-surface-primary px-2 py-1 text-sm"
              >
                {githubServers.map((s) => (
                  <option key={s.serverName} value={s.serverName}>
                    {s.serverName}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <Label htmlFor="github-context-repo">{localize('com_ui_github_context_repo')}</Label>
            <Input
              id="github-context-repo"
              placeholder={localize('com_ui_github_context_repo_placeholder')}
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              aria-label={localize('com_ui_github_context_repo')}
            />
          </div>
          <div>
            <Label htmlFor="github-context-ref">{localize('com_ui_github_context_ref')}</Label>
            <Input
              id="github-context-ref"
              placeholder="main"
              value={refValue}
              onChange={(e) => setRefValue(e.target.value)}
              aria-label={localize('com_ui_github_context_ref')}
            />
          </div>
          <div>
            <Label htmlFor="github-context-kind">
              {localize('com_ui_github_context_select_kind')}
            </Label>
            <select
              id="github-context-kind"
              aria-label={localize('com_ui_github_context_select_kind')}
              value={itemType}
              onChange={(e) => setItemType(e.target.value as GithubContextItemType)}
              className="block w-full rounded border border-border-light bg-surface-primary px-2 py-1 text-sm"
            >
              {KIND_OPTIONS.map((k) => (
                <option key={k} value={k}>
                  {localize(KIND_LABEL_KEYS[k])}
                </option>
              ))}
            </select>
          </div>
          {itemType === 'file' && (
            <div className="flex flex-col gap-2">
              <div>
                <Label htmlFor="github-context-path">
                  {localize('com_ui_github_context_path')}
                </Label>
                <Input
                  id="github-context-path"
                  placeholder="src/example.ts"
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  aria-label={localize('com_ui_github_context_path')}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="github-context-line-start">
                    {localize('com_ui_github_context_line_start')}
                  </Label>
                  <Input
                    id="github-context-line-start"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={lineStart}
                    onChange={(e) => setLineStart(e.target.value.replace(/\D+/g, ''))}
                    aria-label={localize('com_ui_github_context_line_start')}
                  />
                </div>
                <div>
                  <Label htmlFor="github-context-line-end">
                    {localize('com_ui_github_context_line_end')}
                  </Label>
                  <Input
                    id="github-context-line-end"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={lineEnd}
                    onChange={(e) => setLineEnd(e.target.value.replace(/\D+/g, ''))}
                    aria-label={localize('com_ui_github_context_line_end')}
                  />
                </div>
              </div>
            </div>
          )}
          {(itemType === 'pr' || itemType === 'issue' || itemType === 'commit') && (
            <div>
              <Label htmlFor="github-context-item-id">{localize(ID_LABEL_KEYS[itemType])}</Label>
              <Input
                id="github-context-item-id"
                placeholder={itemType === 'commit' ? 'abc1234' : '42'}
                value={itemId}
                onChange={(e) => setItemId(e.target.value)}
                aria-label={localize(ID_LABEL_KEYS[itemType])}
              />
            </div>
          )}
          {validationError && (
            <p
              role="alert"
              className="text-status-error text-sm"
              data-testid="github-context-validation-error"
            >
              {validationError}
            </p>
          )}
        </div>
        <OGDialogFooter>
          <Button onClick={() => onOpenChange(false)} variant="outline">
            {localize('com_ui_cancel')}
          </Button>
          <Button onClick={onAttach}>{localize('com_ui_github_context_attach')}</Button>
        </OGDialogFooter>
      </OGDialogContent>
    </OGDialog>
  );
}

export default memo(GitHubContextDialogContent);
