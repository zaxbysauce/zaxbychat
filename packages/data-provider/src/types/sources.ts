import { z } from 'zod';

/** Provenance attribution for council-mode legs */
export type LegAttribution = {
  legId: string;
  role: 'direct' | 'inherited' | 'synthesized';
};

export const legAttributionRoleSchema = z.enum(['direct', 'inherited', 'synthesized']);

export const legAttributionSchema = z.object({
  legId: z.string().min(1),
  role: legAttributionRoleSchema,
});

type WebKind = {
  kind: 'web';
  domain: string;
  publishedAt?: string;
  fetchedAt: string;
};

type FileKind = {
  kind: 'file';
  fileId: string;
  fileName: string;
  pages?: number[];
  fileType?: string;
};

type GitHubKind = {
  kind: 'github';
  repo: string;
  ref?: string;
  path?: string;
  lineStart?: number;
  lineEnd?: number;
  itemType?: 'repo' | 'file' | 'pr' | 'issue' | 'commit';
  itemId?: string;
};

type CodeKind = {
  kind: 'code';
  language: string;
  origin?: string;
};

type MemoryKind = {
  kind: 'memory';
  entryId: string;
  createdAt: string;
};

export type SourceKind = 'web' | 'file' | 'github' | 'code' | 'memory';

export const sourceKindSchema = z.enum(['web', 'file', 'github', 'code', 'memory']);

export const githubItemTypeSchema = z.enum(['repo', 'file', 'pr', 'issue', 'commit']);

export const webKindSchema = z.object({
  kind: z.literal('web'),
  domain: z.string().min(1),
  publishedAt: z.string().optional(),
  fetchedAt: z.string().min(1),
});

export const fileKindSchema = z.object({
  kind: z.literal('file'),
  fileId: z.string().min(1),
  fileName: z.string().min(1),
  pages: z.array(z.number().int().nonnegative()).optional(),
  fileType: z.string().optional(),
});

export const githubKindSchema = z.object({
  kind: z.literal('github'),
  repo: z.string().min(1),
  ref: z.string().optional(),
  path: z.string().optional(),
  lineStart: z.number().int().positive().optional(),
  lineEnd: z.number().int().positive().optional(),
  itemType: githubItemTypeSchema.optional(),
  itemId: z.string().optional(),
});

export const codeKindSchema = z.object({
  kind: z.literal('code'),
  language: z.string().min(1),
  origin: z.string().optional(),
});

export const memoryKindSchema = z.object({
  kind: z.literal('memory'),
  entryId: z.string().min(1),
  createdAt: z.string().min(1),
});

export const kindSpecificSchema = z.discriminatedUnion('kind', [
  webKindSchema,
  fileKindSchema,
  githubKindSchema,
  codeKindSchema,
  memoryKindSchema,
]);

/** Unified citation source record used across retrieval, council, and GitHub integration. */
export type CitationSource = {
  id: string;
  kind: SourceKind;
  title: string;
  url?: string;
  snippet?: string;
  score?: number;
  provider: string;
  legAttribution?: LegAttribution;
  kindSpecific: WebKind | FileKind | GitHubKind | CodeKind | MemoryKind;
};

export const citationSourceSchema = z
  .object({
    id: z.string().min(1),
    kind: sourceKindSchema,
    title: z.string(),
    url: z.string().optional(),
    snippet: z.string().optional(),
    score: z.number().optional(),
    provider: z.string().min(1),
    legAttribution: legAttributionSchema.optional(),
    kindSpecific: kindSpecificSchema,
  })
  .refine((src) => src.kind === src.kindSpecific.kind, {
    message: 'CitationSource.kind must equal kindSpecific.kind',
    path: ['kindSpecific'],
  });

/** Inline citation anchor embedded in assistant message text. */
export type InlineAnchor = {
  sourceId: string;
  range?: [number, number];
};

export const inlineAnchorSchema = z
  .object({
    sourceId: z.string().min(1),
    range: z
      .tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])
      .optional(),
  })
  .refine(
    (a) => !a.range || a.range[0] <= a.range[1],
    { message: 'InlineAnchor.range[0] must be <= range[1]', path: ['range'] },
  );

export const citationSourcesArraySchema = z.array(citationSourceSchema);

export const inlineAnchorsArraySchema = z.array(inlineAnchorSchema);
