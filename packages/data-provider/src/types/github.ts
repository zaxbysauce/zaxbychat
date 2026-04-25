/**
 * Phase 7 PR 7.2 — GitHub context selection (D-P7-10 lock).
 *
 * Selector state shape captured by the frontend picker and threaded
 * through the chat request body to the backend agent run. Mirrors the
 * field set of `RawGithubResult` (PR 7.1 normalizer input) but is
 * semantically distinct: this is *user-selected scope*, not raw tool
 * output. Single-context only in PR 7.2.
 *
 * Honest-shape: any field that cannot be represented honestly is
 * omitted rather than guessed (e.g., `lineEnd` without `lineStart`).
 */

import { z } from 'zod';

export const githubContextItemTypeSchema = z.enum([
  'repo',
  'file',
  'pr',
  'issue',
  'commit',
]);

export type GithubContextItemType = z.infer<typeof githubContextItemTypeSchema>;

export const githubContextSelectionSchema = z
  .object({
    serverName: z.string().min(1),
    repo: z.string().min(1),
    ref: z.string().min(1).optional(),
    path: z.string().min(1).optional(),
    lineStart: z.number().int().positive().optional(),
    lineEnd: z.number().int().positive().optional(),
    itemType: githubContextItemTypeSchema.optional(),
    itemId: z.string().min(1).optional(),
  })
  .superRefine((selection, ctx) => {
    if (
      typeof selection.lineStart === 'number' &&
      typeof selection.lineEnd === 'number' &&
      selection.lineStart > selection.lineEnd
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['lineEnd'],
        message: 'lineEnd must be greater than or equal to lineStart',
      });
    }
    if (typeof selection.lineEnd === 'number' && selection.lineStart === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['lineEnd'],
        message: 'lineEnd requires lineStart',
      });
    }
    if (selection.itemType === 'pr' && !selection.itemId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['itemId'],
        message: 'itemId is required when itemType is pr',
      });
    }
    if (selection.itemType === 'issue' && !selection.itemId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['itemId'],
        message: 'itemId is required when itemType is issue',
      });
    }
    if (selection.itemType === 'commit' && !selection.itemId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['itemId'],
        message: 'itemId is required when itemType is commit',
      });
    }
    if (selection.itemType === 'file' && !selection.path) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['path'],
        message: 'path is required when itemType is file',
      });
    }
  });

export type GithubContextSelection = z.infer<typeof githubContextSelectionSchema>;
