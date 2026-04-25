import { atom } from 'recoil';
import type { GithubContextSelection } from 'librechat-data-provider';

/**
 * Phase 7 PR 7.2 — composer state for the GitHub context picker.
 *
 * Single-context per conversation: holds `null` when nothing is
 * attached, otherwise the user's most recent selection. The chat
 * submit hook reads this atom and threads the selection onto the
 * outgoing submission's `githubContext` field. The atom is cleared
 * after each successful send.
 */
export const githubContextSelectionState = atom<GithubContextSelection | null>({
  key: 'githubContextSelectionState',
  default: null,
});
