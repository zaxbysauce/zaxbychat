import { createContext, useContext } from 'react';
import type { CitationSource, InlineAnchor } from 'librechat-data-provider';

type MessageContext = {
  messageId: string;
  nextType?: string;
  partIndex?: number;
  isExpanded: boolean;
  conversationId?: string | null;
  /** Submission state for cursor display - only true for latest message when submitting */
  isSubmitting?: boolean;
  /** Whether this is the latest message in the conversation */
  isLatestMessage?: boolean;
  /** Phase 5 persisted citation sources for this message, if retrieval ran. */
  sources?: CitationSource[];
  /**
   * Phase 5 persisted inline anchors parsed from `[n]` markers the model
   * emitted. References `sources[*].id`. Absent when the model did not cite.
   */
  inlineAnchors?: InlineAnchor[];
};

export const MessageContext = createContext<MessageContext>({} as MessageContext);
export const useMessageContext = () => useContext(MessageContext);
