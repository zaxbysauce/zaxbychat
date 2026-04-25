import type { IUser, AppConfig } from '@librechat/data-schemas';
import type { TEndpointOption, GithubContextSelection } from 'librechat-data-provider';
import type { Request } from 'express';

/**
 * LibreChat-specific request body type that extends Express Request body
 * (have to use type alias because you can't extend indexed access types like Request['body'])
 */
export type RequestBody = {
  messageId?: string;
  fileTokenLimit?: number;
  conversationId?: string;
  parentMessageId?: string;
  endpoint?: string;
  endpointType?: string;
  model?: string;
  key?: string;
  endpointOption?: Partial<TEndpointOption>;
  /**
   * Phase 7 PR 7.2 — selected GitHub context attached by the user via the
   * frontend picker. Validated by `githubContextSelectionSchema` in
   * `packages/api/src/agents/initialize.ts`. Single-context per request.
   */
  githubContext?: GithubContextSelection;
};

export type ServerRequest = Request<unknown, unknown, RequestBody> & {
  user?: IUser;
  config?: AppConfig;
};
