/**
 * Phase 6 — RAG prompt builder.
 *
 * Port of ragappv3 `backend/app/services/prompt_builder.py` (donor SHA
 * 1095cb7c5f54f7b3a8832d37cc3ebb0da32472c5, lines 1-211). Faithful to the
 * donor's `[S#]` stable source-label scheme; explicitly independent of
 * Phase 5's `[n]` citation-marker instruction (D-P6-3 lock).
 *
 * Settings globals are replaced with a `PromptBuilderConfig` injected at
 * construction time. `MemoryRecord` is the port-local shape from
 * `./types` (D-P6-6 lock).
 */

import type { RagSource, MemoryRecord } from './types';

export const CITATION_INSTRUCTION =
  '\n\nWhen answering questions based on the provided context:\n' +
  '- Cite your sources inline using only the stable source labels provided (e.g. [S1], [S2], [S3])\n' +
  '- Do NOT cite by filename. Always use the [S#] label assigned to each source.\n' +
  '- If the provided context does not contain enough information to answer the question, ' +
  'clearly state that the information is not available in the retrieved documents\n' +
  '- Do not fabricate or hallucinate information not present in the context\n' +
  '- Prefer citing primary evidence over supporting evidence when both are available';

export const DEFAULT_SYSTEM_PROMPT =
  'You are KnowledgeVault, a highly accurate assistant that references sources when ' +
  'answering questions. Cite the relevant documents or memories using their assigned ' +
  'source labels (e.g. [S1], [S2]).' +
  CITATION_INSTRUCTION;

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type PromptBuilderConfig = {
  primaryEvidenceCount: number;
  maxContextChunks: number;
  contextMaxTokens: number;
  anchorBestChunk: boolean;
  parentRetrievalEnabled: boolean;
  maxHistoryMessages: number;
};

export const DEFAULT_PROMPT_BUILDER_CONFIG: PromptBuilderConfig = {
  primaryEvidenceCount: 0,
  maxContextChunks: 10,
  contextMaxTokens: 8000,
  anchorBestChunk: false,
  parentRetrievalEnabled: false,
  maxHistoryMessages: 20,
};

export type BuildMessagesInput = {
  userInput: string;
  chatHistory: ChatMessage[];
  chunks: RagSource[];
  memories: MemoryRecord[];
  relevanceHint?: string;
};

/**
 * Donor `calculate_primary_count` (prompt_builder.py:22-41). Formula:
 * `min(max(n - 2, 3), min(n, 5))`. Overridden by `primaryEvidenceCount`
 * when `> 0`.
 */
export function calculatePrimaryCount(totalChunks: number, override: number): number {
  if (totalChunks === 0) return 0;
  if (override > 0) return Math.min(override, totalChunks);
  return Math.min(Math.max(totalChunks - 2, 3), Math.min(totalChunks, 5));
}

export class PromptBuilder {
  private readonly systemPrompt: string;
  private readonly config: PromptBuilderConfig;

  constructor(options: { systemPrompt?: string; config?: Partial<PromptBuilderConfig> } = {}) {
    this.systemPrompt = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    this.config = { ...DEFAULT_PROMPT_BUILDER_CONFIG, ...(options.config ?? {}) };
  }

  getSystemPrompt(): string {
    return this.systemPrompt;
  }

  /**
   * Donor `build_messages` (prompt_builder.py:68-147). Splits chunks
   * into primary/supporting, renders each with a stable `[S#]` label,
   * and optionally anchors the top chunk at the tail of the user
   * message to mitigate lost-in-the-middle.
   */
  buildMessages(input: BuildMessagesInput): ChatMessage[] {
    const { userInput, chatHistory, chunks, memories, relevanceHint } = input;
    const primaryCount = calculatePrimaryCount(chunks.length, this.config.primaryEvidenceCount);
    const primaryChunks = chunks.slice(0, primaryCount);
    const supportingChunks = chunks.slice(primaryCount);

    const primarySections = primaryChunks.map((ch, idx) => this.formatChunk(ch, idx + 1));
    const supportingSections = supportingChunks.map((ch, idx) =>
      this.formatChunk(ch, idx + primaryCount + 1),
    );

    const memoryContext = memories.map((m) => m.value).filter((v) => v && v.length > 0);

    const messages: ChatMessage[] = [{ role: 'system', content: this.systemPrompt }];

    const historyTail = chatHistory.slice(-this.config.maxHistoryMessages);
    for (const entry of historyTail) {
      messages.push(entry);
    }

    const userContent = this.assembleUserContent({
      userInput,
      relevanceHint,
      primarySections,
      supportingSections,
      primaryChunks,
      memoryContext,
    });

    messages.push({ role: 'user', content: userContent });
    return messages;
  }

  /**
   * Donor `format_chunk` (prompt_builder.py:149-211). Renders a chunk
   * with its stable source label, optional section heading, score,
   * file id, and contextual-context note. When
   * `parentRetrievalEnabled` is set and a parent window exists, the
   * wider window is rendered with the matched span wrapped in
   * `[[MATCH: …]]` markers.
   * @note Metadata fields (`source_file`, `section_title`, `text`, etc.)
   * flow directly into prompts. Sanitization / content filtering is a
   * consideration for Phase 7/8 when this module is wired to live LLM
   * calls. This matches the donor Python behavior.
   */
  formatChunk(chunk: RagSource, sourceIndex: number): string {
    const filename =
      chunk.metadata.source_file ||
      chunk.metadata.filename ||
      chunk.metadata.section_title ||
      'document';
    const section = chunk.metadata.section_title || chunk.metadata.heading || '';
    const label = `[S${sourceIndex}]`;

    const headerParts: string[] = [`${label} ${filename}`];
    if (section && section !== filename) {
      headerParts.push(`Section: ${section}`);
    }
    headerParts.push(`score: ${chunk.score.toFixed(2)}`);
    if (chunk.fileId) {
      headerParts.push(`id: ${chunk.fileId}`);
    }
    const ctxNote = chunk.metadata.contextual_context;
    if (typeof ctxNote === 'string' && ctxNote) {
      headerParts.push(`context: ${ctxNote.slice(0, 200)}`);
    }

    const header = headerParts.join(' | ');

    if (this.config.parentRetrievalEnabled && chunk.parentWindowText) {
      const rawText = chunk.metadata.raw_text;
      const matchBase = typeof rawText === 'string' && rawText ? rawText : chunk.text ?? '';
      const matchText = matchBase.trim();
      const parentText = chunk.parentWindowText;

      const marked =
        matchText && parentText.includes(matchText)
          ? parentText.replace(matchText, `[[MATCH: ${matchText}]]`)
          : `${parentText}\n\n[[MATCH: ${matchText}]]`;

      return `${header}\n${marked}`;
    }

    return `${header}\n${chunk.text}`;
  }

  private assembleUserContent(args: {
    userInput: string;
    relevanceHint?: string;
    primarySections: string[];
    supportingSections: string[];
    primaryChunks: RagSource[];
    memoryContext: string[];
  }): string {
    const parts: string[] = [];
    if (args.relevanceHint) parts.push(args.relevanceHint);

    if (args.primarySections.length > 0) {
      parts.push(`Primary Evidence:\n${args.primarySections.join('\n\n')}`);
    }
    if (args.supportingSections.length > 0) {
      parts.push(`Supporting Evidence:\n${args.supportingSections.join('\n\n')}`);
    }
    if (args.primarySections.length === 0 && args.supportingSections.length === 0) {
      parts.push('No relevant documents found for this query.');
    }

    if (this.config.anchorBestChunk && args.primaryChunks.length > 0) {
      const topChunk = args.primaryChunks[0];
      const topChunkTokens = Math.max(1, Math.floor(topChunk.text.length / 3.5));
      if (topChunkTokens <= this.config.contextMaxTokens * 0.5) {
        const anchorSection = this.formatChunk(topChunk, 1);
        parts.push(`[BEST MATCH — repeated for emphasis]\n${anchorSection}`);
      }
    }

    let content = parts.join('\n\n') + '\n\n';

    const memoryText = args.memoryContext.join('\n');
    if (memoryText) {
      content += `Memories:\n${memoryText}\n\n`;
    }

    content += `Question: ${args.userInput}`;
    return content;
  }
}
