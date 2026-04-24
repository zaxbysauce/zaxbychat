import { logger } from '@librechat/data-schemas';
import type { AppConfig } from '@librechat/data-schemas';
import {
  Tools,
  Constants,
  isAgentsEndpoint,
  isEphemeralAgentId,
  appendAgentIdSuffix,
  encodeEphemeralAgentId,
} from 'librechat-data-provider';
import type { Agent, TConversation } from 'librechat-data-provider';
import { getCustomEndpointConfig } from '~/app/config';

const { mcp_all, mcp_delimiter } = Constants;

export const ADDED_AGENT_ID = 'added_agent';

export interface LoadAddedAgentDeps {
  getAgent: (searchParameter: { id: string }) => Promise<Agent | null>;
  getMCPServerTools: (
    userId: string,
    serverName: string,
  ) => Promise<Record<string, unknown> | null>;
}

interface LoadAddedAgentParams {
  req: { user?: { id?: string }; config?: Record<string, unknown> };
  conversation: TConversation | null;
  primaryAgent?: Agent | null;
  /**
   * 1-based position within the "extra legs alongside the primary" group,
   * used to disambiguate agent IDs so each leg streams with a distinct agentId.
   *
   * `addedConvo` requests always use index=1 (backward-compatible default).
   * Council-mode requests set index=1 for the first extra and index=2 for
   * the second extra (max 2 per the Phase 4 §D8 bound).
   */
  index?: number;
}

/**
 * Loads an agent from an added conversation (for multi-convo parallel agent execution).
 * Returns the agent config as a plain object, or null if invalid.
 */
export async function loadAddedAgent(
  { req, conversation, primaryAgent, index = 1 }: LoadAddedAgentParams,
  deps: LoadAddedAgentDeps,
): Promise<Agent | null> {
  if (!conversation) {
    return null;
  }

  if (index < 1) {
    throw new Error(`loadAddedAgent: index must be >= 1 (got ${index})`);
  }

  if (conversation.agent_id && !isEphemeralAgentId(conversation.agent_id)) {
    const reqRecord = req as Record<string, unknown>;
    let agent = reqRecord.resolvedAddedAgent as Agent | null | undefined;
    if (!agent) {
      agent = await deps.getAgent({ id: conversation.agent_id });
    }
    if (!agent) {
      logger.warn(`[loadAddedAgent] Agent ${conversation.agent_id} not found`);
      return null;
    }

    const agentRecord = agent as Record<string, unknown>;
    const versions = agentRecord.versions as unknown[] | undefined;
    agentRecord.version = versions ? versions.length : 0;
    agent.id = appendAgentIdSuffix(agent.id, index);
    return agent;
  }

  const { model, endpoint, promptPrefix, spec, ...rest } = conversation as TConversation & {
    promptPrefix?: string;
    spec?: string;
    modelLabel?: string;
    ephemeralAgent?: {
      mcp?: string[];
      execute_code?: boolean;
      file_search?: boolean;
      web_search?: boolean;
      artifacts?: unknown;
    };
    [key: string]: unknown;
  };

  if (!endpoint || !model) {
    logger.warn('[loadAddedAgent] Missing required endpoint or model for ephemeral agent');
    return null;
  }

  const appConfig = req.config as AppConfig | undefined;

  const primaryIsEphemeral = primaryAgent && isEphemeralAgentId(primaryAgent.id);
  if (primaryIsEphemeral && Array.isArray(primaryAgent.tools)) {
    let endpointConfig = (appConfig?.endpoints as Record<string, unknown> | undefined)?.[
      endpoint
    ] as Record<string, unknown> | undefined;
    if (!isAgentsEndpoint(endpoint) && !endpointConfig) {
      try {
        endpointConfig = getCustomEndpointConfig({ endpoint, appConfig }) as
          | Record<string, unknown>
          | undefined;
      } catch (err) {
        logger.error('[loadAddedAgent] Error getting custom endpoint config', err);
      }
    }

    const modelSpecs = (appConfig?.modelSpecs as { list?: Array<{ name: string; label?: string }> })
      ?.list;
    const modelSpec = spec != null && spec !== '' ? modelSpecs?.find((s) => s.name === spec) : null;
    const sender =
      rest.modelLabel ??
      modelSpec?.label ??
      (endpointConfig?.modelDisplayLabel as string | undefined) ??
      '';
    const ephemeralId = encodeEphemeralAgentId({ endpoint, model, sender, index });

    return {
      id: ephemeralId,
      instructions: promptPrefix || '',
      provider: endpoint,
      model_parameters: {},
      model,
      tools: [...primaryAgent.tools],
    } as unknown as Agent;
  }

  const ephemeralAgent = rest.ephemeralAgent as
    | {
        mcp?: string[];
        execute_code?: boolean;
        file_search?: boolean;
        web_search?: boolean;
        artifacts?: unknown;
      }
    | undefined;
  const mcpServers = new Set<string>(ephemeralAgent?.mcp);
  const userId = req.user?.id ?? '';

  const modelSpecs = (
    appConfig?.modelSpecs as {
      list?: Array<{
        name: string;
        label?: string;
        mcpServers?: string[];
        executeCode?: boolean;
        fileSearch?: boolean;
        webSearch?: boolean;
      }>;
    }
  )?.list;
  let modelSpec: (typeof modelSpecs extends Array<infer T> | undefined ? T : never) | null = null;
  if (spec != null && spec !== '') {
    modelSpec = modelSpecs?.find((s) => s.name === spec) ?? null;
  }
  if (modelSpec?.mcpServers) {
    for (const mcpServer of modelSpec.mcpServers) {
      mcpServers.add(mcpServer);
    }
  }

  const tools: string[] = [];
  if (ephemeralAgent?.execute_code === true || modelSpec?.executeCode === true) {
    tools.push(Tools.execute_code);
  }
  if (ephemeralAgent?.file_search === true || modelSpec?.fileSearch === true) {
    tools.push(Tools.file_search);
  }
  if (ephemeralAgent?.web_search === true || modelSpec?.webSearch === true) {
    tools.push(Tools.web_search);
  }

  const addedServers = new Set<string>();
  for (const mcpServer of mcpServers) {
    if (addedServers.has(mcpServer)) {
      continue;
    }
    const serverTools = await deps.getMCPServerTools(userId, mcpServer);
    if (!serverTools) {
      tools.push(`${mcp_all}${mcp_delimiter}${mcpServer}`);
      addedServers.add(mcpServer);
      continue;
    }
    tools.push(...Object.keys(serverTools));
    addedServers.add(mcpServer);
  }

  const model_parameters: Record<string, unknown> = {};
  const paramKeys = [
    'temperature',
    'top_p',
    'topP',
    'topK',
    'presence_penalty',
    'frequency_penalty',
    'maxOutputTokens',
    'maxTokens',
    'max_tokens',
  ];
  for (const key of paramKeys) {
    if ((rest as Record<string, unknown>)[key] != null) {
      model_parameters[key] = (rest as Record<string, unknown>)[key];
    }
  }

  let endpointConfig = (appConfig?.endpoints as Record<string, unknown> | undefined)?.[endpoint] as
    | Record<string, unknown>
    | undefined;
  if (!isAgentsEndpoint(endpoint) && !endpointConfig) {
    try {
      endpointConfig = getCustomEndpointConfig({ endpoint, appConfig }) as
        | Record<string, unknown>
        | undefined;
    } catch (err) {
      logger.error('[loadAddedAgent] Error getting custom endpoint config', err);
    }
  }

  const sender =
    rest.modelLabel ??
    modelSpec?.label ??
    (endpointConfig?.modelDisplayLabel as string | undefined) ??
    '';
  const ephemeralId = encodeEphemeralAgentId({ endpoint, model, sender, index });

  const result: Record<string, unknown> = {
    id: ephemeralId,
    instructions: promptPrefix || '',
    provider: endpoint,
    model_parameters,
    model,
    tools,
  };

  if (ephemeralAgent?.artifacts != null && ephemeralAgent.artifacts) {
    result.artifacts = ephemeralAgent.artifacts;
  }

  return result as unknown as Agent;
}
