const { logger } = require('@librechat/data-schemas');
const { loadAgent: loadAgentFn } = require('@librechat/api');
const { isAgentsEndpoint, removeNullishValues, Constants } = require('librechat-data-provider');
const { getMCPServerTools } = require('~/server/services/Config');
const db = require('~/models');

const loadAgent = (params) => loadAgentFn(params, { getAgent: db.getAgent, getMCPServerTools });

const buildOptions = (req, endpoint, parsedBody, endpointType) => {
  const { spec, iconURL, agent_id, ...model_parameters } = parsedBody;
  const agentPromise = loadAgent({
    req,
    spec,
    agent_id: isAgentsEndpoint(endpoint) ? agent_id : Constants.EPHEMERAL_AGENT_ID,
    endpoint,
    model_parameters,
  }).catch((error) => {
    logger.error(`[/agents/:${agent_id}] Error retrieving agent during build options step`, error);
    return undefined;
  });

  /** @type {import('librechat-data-provider').TConversation | undefined} */
  const addedConvo = req.body?.addedConvo;

  /**
   * Phase 4 council mode. The actual gate that validates shape + flag lives
   * server-side in processCouncilAgents (§D1 precedence: councilAgents wins
   * over addedConvo when present). Here we only forward the raw fields from
   * the request body onto endpointOption so downstream code can inspect them.
   */
  const councilAgents = Array.isArray(req.body?.councilAgents)
    ? req.body.councilAgents
    : undefined;
  const councilStrategy =
    typeof req.body?.councilStrategy === 'string' ? req.body.councilStrategy : undefined;

  return removeNullishValues({
    spec,
    iconURL,
    endpoint,
    agent_id,
    endpointType,
    model_parameters,
    agent: agentPromise,
    addedConvo,
    councilAgents,
    councilStrategy,
  });
};

module.exports = { buildOptions };
