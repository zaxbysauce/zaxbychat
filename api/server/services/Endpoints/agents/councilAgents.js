const { logger } = require('@librechat/data-schemas');
const {
  ADDED_AGENT_ID,
  initializeAgent,
  validateAgentModel,
  loadAddedAgent: loadAddedAgentFn,
  resolveCouncilExtras,
} = require('@librechat/api');
const { filterFilesByAgentAccess } = require('~/server/services/Files/permissions');
const { getMCPServerTools } = require('~/server/services/Config');
const db = require('~/models');

const loadAddedAgent = (params) =>
  loadAddedAgentFn(params, { getAgent: db.getAgent, getMCPServerTools });

/**
 * Process `endpointOption.councilAgents` (Phase 4) for parallel multi-leg execution.
 *
 * Gates (all must be true):
 *   - `interfaceSchema.council === true`
 *   - `councilAgents` validates against councilAgentsSchema
 *   - Composition is unique across primary + extras
 *   - At least one extra present
 *
 * When any gate fails, this is a no-op and the addedConvo path (if present)
 * continues unaffected. When gates pass, each extra is loaded as a parallel
 * agent with a distinct index (1, 2) so their agent IDs are unique and
 * content parts are tagged per-leg.
 *
 * Returns the set of leg agent ids (primary + any added extras) so callers
 * know the full council composition for downstream wiring.
 *
 * @param {Object} params
 * @param {import('express').Request} params.req
 * @param {import('express').Response} params.res
 * @param {Object} params.endpointOption - Contains councilAgents (optional)
 * @param {Object} params.modelsConfig
 * @param {Function} params.logViolation
 * @param {Function} params.loadTools
 * @param {Array} params.requestFiles
 * @param {string} params.conversationId
 * @param {string} [params.parentMessageId]
 * @param {Set} params.allowedProviders
 * @param {Map} params.agentConfigs
 * @param {string} params.primaryAgentId
 * @param {Object} params.primaryAgent
 * @param {Object|undefined} params.userMCPAuthMap
 * @returns {Promise<{
 *   userMCPAuthMap: Object|undefined,
 *   active: boolean,
 *   legAgentIds: string[],
 * }>}
 */
const processCouncilAgents = async ({
  req,
  res,
  endpointOption,
  modelsConfig,
  logViolation,
  loadTools,
  requestFiles,
  conversationId,
  parentMessageId,
  allowedProviders,
  agentConfigs,
  primaryAgentId,
  primaryAgent,
  userMCPAuthMap,
}) => {
  const primary = {
    endpoint: endpointOption?.endpoint ?? '',
    model: endpointOption?.model ?? '',
    agent_id: endpointOption?.agent_id ?? null,
  };

  const extras = resolveCouncilExtras({
    appConfig: req?.config,
    councilAgents: endpointOption?.councilAgents,
    primary,
  });

  if (!extras || extras.length === 0) {
    return { userMCPAuthMap, active: false, legAgentIds: [primaryAgentId] };
  }

  logger.debug('[processCouncilAgents] Council mode active', {
    extrasCount: extras.length,
    primaryAgentId,
    primaryEndpoint: primary.endpoint,
    primaryModel: primary.model,
  });

  const legAgentIds = [primaryAgentId];
  let updatedMCPAuthMap = userMCPAuthMap;

  for (let i = 0; i < extras.length; i++) {
    const extra = extras[i];
    const index = i + 1;

    const legConversation = {
      endpoint: extra.endpoint,
      model: extra.model,
      agent_id: extra.agent_id,
    };

    try {
      const extraAgent = await loadAddedAgent({
        req,
        conversation: legConversation,
        primaryAgent,
        index,
      });
      if (!extraAgent) {
        logger.warn(
          `[processCouncilAgents] loadAddedAgent returned null for extra ${index} (${extra.endpoint}/${extra.model})`,
        );
        continue;
      }

      const validation = await validateAgentModel({
        req,
        res,
        modelsConfig,
        logViolation,
        agent: extraAgent,
      });
      if (!validation.isValid) {
        logger.warn(
          `[processCouncilAgents] Extra ${index} validation failed: ${validation.error?.message}`,
        );
        continue;
      }

      const extraConfig = await initializeAgent(
        {
          req,
          res,
          loadTools,
          requestFiles,
          conversationId,
          parentMessageId,
          agent: extraAgent,
          endpointOption,
          allowedProviders,
        },
        {
          getFiles: db.getFiles,
          getUserKey: db.getUserKey,
          getMessages: db.getMessages,
          getConvoFiles: db.getConvoFiles,
          updateFilesUsage: db.updateFilesUsage,
          getUserCodeFiles: db.getUserCodeFiles,
          getUserKeyValues: db.getUserKeyValues,
          getToolFilesByIds: db.getToolFilesByIds,
          getCodeGeneratedFiles: db.getCodeGeneratedFiles,
          filterFilesByAgentAccess,
        },
      );

      if (updatedMCPAuthMap != null) {
        Object.assign(updatedMCPAuthMap, extraConfig.userMCPAuthMap ?? {});
      } else {
        updatedMCPAuthMap = extraConfig.userMCPAuthMap;
      }

      const extraAgentId = extraConfig.id || `${ADDED_AGENT_ID}____${index}`;
      agentConfigs.set(extraAgentId, extraConfig);
      legAgentIds.push(extraAgentId);

      logger.debug(
        `[processCouncilAgents] Added council extra ${index}: ${extraAgentId} (primary: ${primaryAgentId})`,
      );
    } catch (err) {
      logger.error(
        `[processCouncilAgents] Error processing extra ${index} (${extra.endpoint}/${extra.model})`,
        err,
      );
    }
  }

  const active = legAgentIds.length > 1;
  return {
    userMCPAuthMap: updatedMCPAuthMap,
    active,
    legAgentIds,
  };
};

module.exports = {
  processCouncilAgents,
};
