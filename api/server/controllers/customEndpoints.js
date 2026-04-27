/**
 * Phase 9 — DB-backed custom-endpoint CRUD controllers.
 *
 * The four CRUD verbs + a Test Connection probe operate on the
 * `CustomEndpoint` collection. ACL: USE/CREATE/UPDATE permissions
 * are gated at the route layer via `generateCheckAccess`; row-level
 * ownership (delete + update) is enforced inside the controller by
 * comparing `record.author` to `req.user.id`. Single-user offline
 * deployment: any USER role with permissions can manage their own
 * records; ADMIN can manage anyone's.
 *
 * Validation goes through the Zod schemas exported from
 * `librechat-data-provider` (`customEndpointConfigSchema`,
 * `customEndpointCreateParamsSchema`, etc.). The URL gate is the
 * permissive sibling validator from `@librechat/api`
 * (`validateCustomEndpointBaseUrl`).
 */
const { logger } = require('@librechat/data-schemas');
const {
  validateCustomEndpointBaseUrl,
  shouldAllowLocalEndpointAddresses,
  probeCustomEndpoint,
} = require('@librechat/api');
const {
  customEndpointCreateParamsSchema,
  customEndpointUpdateParamsSchema,
  testCustomEndpointParamsSchema,
  SystemRoles,
} = require('librechat-data-provider');
const {
  createCustomEndpoint,
  findCustomEndpointByName,
  listCustomEndpoints,
  updateCustomEndpoint,
  deleteCustomEndpoint,
} = require('~/models');
const {
  invalidateDbCustomEndpointsCache,
} = require('~/server/middleware/config/customEndpoints');

const USER_PROVIDED = 'user_provided';

/**
 * Strip secrets from a config blob before returning it on a list /
 * read response (review H1). Keeps the YAML shape but never leaks a
 * literal `apiKey` to other users on the deployment. The
 * `apiKeyProvided` boolean tells the UI whether *any* key was set so
 * the dialog can render a "Replace existing key" affordance without
 * showing the value.
 */
function redactConfigForList(config) {
  if (!config || typeof config !== 'object') return config;
  const apiKey = typeof config.apiKey === 'string' ? config.apiKey : '';
  const isUserProvided = apiKey === USER_PROVIDED;
  return {
    ...config,
    apiKey: isUserProvided ? USER_PROVIDED : null,
    apiKeyProvided: isUserProvided ? false : apiKey.length > 0,
  };
}

function toResponse(doc, options = {}) {
  if (!doc) return null;
  const config = options.includeSecrets ? doc.config : redactConfigForList(doc.config);
  return {
    _id: doc._id ? doc._id.toString() : undefined,
    name: doc.name,
    config,
    author: doc.author ? doc.author.toString() : null,
    tenantId: doc.tenantId ?? null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    source: 'db',
  };
}

/**
 * Reject empty-string values that would survive Zod's optional-field
 * checks but corrupt the merged registry (review H2 / L5). For
 * required-on-update fields, an empty string overwrites the existing
 * record's value via the model's spread merge and silently removes
 * the endpoint from the dropdown.
 */
function rejectEmptyStringFields(config) {
  if (!config || typeof config !== 'object') return null;
  if (config.baseURL !== undefined && (typeof config.baseURL !== 'string' || config.baseURL.trim() === '')) {
    return 'baseURL cannot be empty';
  }
  if (config.apiKey !== undefined && (typeof config.apiKey !== 'string' || config.apiKey.trim() === '')) {
    return 'apiKey cannot be empty';
  }
  if (config.name !== undefined && (typeof config.name !== 'string' || config.name.trim() === '')) {
    return 'name cannot be empty';
  }
  return null;
}

function isAdmin(req) {
  return req.user?.role === SystemRoles.ADMIN;
}

function isOwner(record, req) {
  if (!record?.author) return false;
  const authorId = typeof record.author === 'string' ? record.author : record.author.toString();
  return authorId === req.user?.id;
}

const listEndpoints = async (req, res) => {
  try {
    const all = await listCustomEndpoints();
    // Always redact on list — review H1. apiKey is never returned to
    // any caller; downstream config consumers go through the
    // middleware-merged `req.config.endpoints.custom`, which holds
    // the unredacted shape for actual chat dispatch.
    return res.status(200).json(all.map((doc) => toResponse(doc)));
  } catch (error) {
    logger.error('[customEndpoints.list]', error);
    return res.status(500).json({ message: 'Failed to list custom endpoints' });
  }
};

const createEndpoint = async (req, res) => {
  const parsed = customEndpointCreateParamsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      message: 'Invalid create params',
      issues: parsed.error.issues,
    });
  }
  const { config } = parsed.data;
  const emptyError = rejectEmptyStringFields(config);
  if (emptyError) {
    return res.status(400).json({ message: emptyError });
  }
  const allowLocal = shouldAllowLocalEndpointAddresses();
  const urlCheck = validateCustomEndpointBaseUrl(config.baseURL, {
    allowLocalAddresses: allowLocal,
  });
  if (!urlCheck.ok) {
    return res.status(400).json({ message: urlCheck.reason });
  }
  if (!req.user?.id) return res.status(401).json({ message: 'Authentication required' });

  try {
    const existing = await findCustomEndpointByName(config.name);
    if (existing) {
      return res.status(409).json({ message: `Endpoint "${config.name}" already exists` });
    }
    const created = await createCustomEndpoint({
      name: config.name,
      config,
      author: req.user.id,
      tenantId: req.user.tenantId,
    });
    invalidateDbCustomEndpointsCache();
    return res.status(201).json(toResponse(created));
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: `Endpoint "${config.name}" already exists` });
    }
    logger.error('[customEndpoints.create]', error);
    return res.status(500).json({ message: 'Failed to create custom endpoint' });
  }
};

const updateEndpoint = async (req, res) => {
  const { name } = req.params;
  if (typeof name !== 'string' || !name) {
    return res.status(400).json({ message: 'name is required' });
  }
  const parsed = customEndpointUpdateParamsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      message: 'Invalid update params',
      issues: parsed.error.issues,
    });
  }
  const config = parsed.data.config ?? {};
  // Review H2: reject empty-string overwrites BEFORE the URL gate.
  // Without this, a PATCH `{ config: { baseURL: "" } }` would slip
  // through `if (config.baseURL)` (falsy) and the model's spread
  // merge would erase the existing valid baseURL.
  const emptyError = rejectEmptyStringFields(config);
  if (emptyError) {
    return res.status(400).json({ message: emptyError });
  }
  if (config.baseURL !== undefined) {
    const allowLocal = shouldAllowLocalEndpointAddresses();
    const urlCheck = validateCustomEndpointBaseUrl(config.baseURL, {
      allowLocalAddresses: allowLocal,
    });
    if (!urlCheck.ok) {
      return res.status(400).json({ message: urlCheck.reason });
    }
  }

  try {
    const existing = await findCustomEndpointByName(name);
    if (!existing) {
      return res.status(404).json({ message: 'Not found' });
    }
    if (!isAdmin(req) && !isOwner(existing, req)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    const updated = await updateCustomEndpoint(name, { config });
    invalidateDbCustomEndpointsCache();
    return res.status(200).json(toResponse(updated));
  } catch (error) {
    logger.error('[customEndpoints.update]', error);
    return res.status(500).json({ message: 'Failed to update custom endpoint' });
  }
};

const deleteEndpoint = async (req, res) => {
  const { name } = req.params;
  if (typeof name !== 'string' || !name) {
    return res.status(400).json({ message: 'name is required' });
  }
  try {
    const existing = await findCustomEndpointByName(name);
    if (!existing) {
      return res.status(404).json({ message: 'Not found' });
    }
    if (!isAdmin(req) && !isOwner(existing, req)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    const result = await deleteCustomEndpoint(name);
    if (result.deletedCount === 0) {
      return res.status(404).json({ message: 'Not found' });
    }
    invalidateDbCustomEndpointsCache();
    return res.status(200).json({ ok: true });
  } catch (error) {
    logger.error('[customEndpoints.delete]', error);
    return res.status(500).json({ message: 'Failed to delete custom endpoint' });
  }
};

const testEndpoint = async (req, res) => {
  const parsed = testCustomEndpointParamsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      message: 'Invalid test params',
      issues: parsed.error.issues,
    });
  }
  try {
    const result = await probeCustomEndpoint(parsed.data.config);
    return res.status(200).json(result);
  } catch (error) {
    logger.error('[customEndpoints.test]', error);
    return res.status(500).json({ message: 'Probe failed', reason: error?.message });
  }
};

module.exports = {
  listEndpoints,
  createEndpoint,
  updateEndpoint,
  deleteEndpoint,
  testEndpoint,
  toResponse,
};
