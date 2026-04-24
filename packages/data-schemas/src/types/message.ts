import type { Document } from 'mongoose';
import type { TFeedbackRating, TFeedbackTag } from 'librechat-data-provider';

// @ts-ignore
export interface IMessage extends Document {
  messageId: string;
  conversationId: string;
  user: string;
  model?: string;
  endpoint?: string;
  conversationSignature?: string;
  clientId?: string;
  invocationId?: number;
  parentMessageId?: string | null;
  tokenCount?: number;
  summaryTokenCount?: number;
  sender?: string;
  text?: string;
  summary?: string;
  isCreatedByUser: boolean;
  unfinished?: boolean;
  error?: boolean;
  finish_reason?: string;
  feedback?: {
    rating: TFeedbackRating;
    tag: TFeedbackTag | undefined;
    text?: string;
  };
  _meiliIndex?: boolean;
  files?: unknown[];
  plugin?: {
    latest?: string;
    inputs?: unknown[];
    outputs?: string;
  };
  plugins?: unknown[];
  content?: unknown[];
  thread_id?: string;
  iconURL?: string;
  addedConvo?: boolean;
  metadata?: Record<string, unknown>;
  contextMeta?: {
    calibrationRatio?: number;
    encoding?: string;
  };
  attachments?: unknown[];
  expiredAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
  tenantId?: string;
  /**
   * Phase 5 persisted normalized citation sources (additive; see
   * `librechat-data-provider` `CitationSource`). Absent for pre-Phase-5
   * messages and for turns without retrieval. Persistence only.
   */
  sources?: unknown[];
  /**
   * Phase 5 persisted inline anchors parsed from emitted `[n]` markers
   * (`InlineAnchor[]`). Absent when the model did not cite. References
   * `sources[*].id`, not transient array positions.
   */
  inlineAnchors?: unknown[];
}
