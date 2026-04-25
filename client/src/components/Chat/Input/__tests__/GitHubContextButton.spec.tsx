/**
 * Phase 7 PR 7.2 — GitHub context button render-gating + selection flow.
 *
 * Validates the visibility gates (flag + at least one `kind:'github'`
 * server), modal open/close, chip render after selection, and
 * chip-remove clearing the recoil atom.
 */
import React from 'react';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import { RecoilRoot } from 'recoil';

let mockEnabled = true;
let mockServers: Array<{ serverName: string; config: Record<string, unknown> }> = [
  { serverName: 'github', config: { kind: 'github' } },
];

jest.mock('~/hooks/MCP/useGithubFirstClass', () => ({
  useGithubFirstClassEnabled: () => mockEnabled,
  useGithubMcpServers: () => mockServers,
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('@librechat/client', () => ({
  __esModule: true,
  TooltipAnchor: ({ render: r }: { render: React.ReactNode }) => <>{r}</>,
  Label: ({ children }: { children: React.ReactNode }) => <label>{children}</label>,
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Button: ({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...rest}>{children}</button>
  ),
  Spinner: () => <span data-testid="spinner" />,
  OGDialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null,
  OGDialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  OGDialogHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header>,
  OGDialogFooter: ({ children }: { children: React.ReactNode }) => <footer>{children}</footer>,
  OGDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import GitHubContextButton from '../GitHubContext/GitHubContextButton';

const renderButton = () =>
  render(
    <RecoilRoot>
      <GitHubContextButton />
    </RecoilRoot>,
  );

describe('GitHubContextButton — gating', () => {
  beforeEach(() => {
    mockEnabled = true;
    mockServers = [{ serverName: 'github', config: { kind: 'github' } }];
  });

  it('renders nothing when the flag is off', () => {
    mockEnabled = false;
    const { container } = renderButton();
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when no kind:github servers exist', () => {
    mockServers = [];
    const { container } = renderButton();
    expect(container.firstChild).toBeNull();
  });

  it('renders the button when both gates pass', () => {
    renderButton();
    expect(screen.getByTestId('github-context-button')).toBeInTheDocument();
  });
});

describe('GitHubContextButton — modal flow', () => {
  it('opens the picker dialog on click', async () => {
    const user = userEvent.setup();
    renderButton();
    await user.click(screen.getByTestId('github-context-button'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('com_ui_github_context_select')).toBeInTheDocument();
  });

  it('renders no-server state when there are zero github servers (defensive)', async () => {
    mockServers = [];
    const user = userEvent.setup();
    const { container } = renderButton();
    expect(container.firstChild).toBeNull();
  });

  it('attaches a valid selection and shows the chip', async () => {
    const user = userEvent.setup();
    renderButton();

    await user.click(screen.getByTestId('github-context-button'));
    await user.type(screen.getByLabelText('com_ui_github_context_repo'), 'a/b');
    await user.type(screen.getByLabelText('com_ui_github_context_path'), 'README.md');

    await user.click(screen.getByText('com_ui_github_context_attach'));

    expect(await screen.findByTestId('github-context-chip')).toBeInTheDocument();
    expect(screen.getByTestId('github-context-chip')).toHaveTextContent('a/b:README.md');
  });

  it('clears the selection when the chip remove button is clicked', async () => {
    const user = userEvent.setup();
    renderButton();
    await user.click(screen.getByTestId('github-context-button'));
    await user.type(screen.getByLabelText('com_ui_github_context_repo'), 'a/b');
    await user.type(screen.getByLabelText('com_ui_github_context_path'), 'x.ts');
    await user.click(screen.getByText('com_ui_github_context_attach'));

    await user.click(screen.getByTestId('github-context-chip-remove'));
    expect(screen.queryByTestId('github-context-chip')).not.toBeInTheDocument();
  });
});
