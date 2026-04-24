export interface TransactionData {
  user: string;
  conversationId: string;
  tokenType: string;
  model?: string;
  context?: string;
  valueKey?: string;
  rate?: number;
  rawAmount?: number;
  tokenValue?: number;
  inputTokens?: number;
  writeTokens?: number;
  readTokens?: number;
  messageId?: string;
  inputTokenCount?: number;
  rateDetail?: Record<string, number>;
  /**
   * Phase 4 council mode: identifies which leg (or `__synthesis__`) produced
   * the tokens this transaction row represents. Absent for non-council
   * transactions. Used to produce (K+1)-row pricing parity when K council
   * legs succeed and synthesis runs.
   */
  agentId?: string;
}
