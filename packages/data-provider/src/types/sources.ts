/** Provenance attribution for council-mode legs */
export type LegAttribution = {
  legId: string;
  role: 'direct' | 'inherited' | 'synthesized';
};

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

/** Inline citation anchor embedded in assistant message text. */
export type InlineAnchor = {
  sourceId: string;
  range?: [number, number];
};
