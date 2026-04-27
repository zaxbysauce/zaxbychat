const { logger } = require('@librechat/data-schemas');
const { mergeCustomEndpointsByName, dbRecordsToEndpoints } = require('@librechat/api');
const { listCustomEndpoints } = require('~/models');

/**
 * Phase 9 — request-scoped middleware that merges DB-backed custom
 * endpoints into `req.config.endpoints.custom`. YAML wins on name
 * collision (delegated to `mergeCustomEndpointsByName`); the merged
 * array is set on a SHALLOW CLONE of `req.config` so any caching
 * `getAppConfig` may do upstream is not polluted across requests.
 *
 * Caching (review M2): a process-wide TTL cache keyed by tenantId
 * (or a global slot when no tenant) avoids a full collection scan on
 * every config-bearing request. The cache is invalidated by the
 * controller after every write (`invalidateDbCustomEndpointsCache`).
 *
 * Failures are logged and swallowed: if the DB is unavailable, the
 * request still succeeds with YAML-only endpoints (degrade-don't-die
 * matches the existing `configMiddleware` posture).
 */

const CACHE_TTL_MS = 30 * 1000;
const cache = new Map();

const GLOBAL_KEY = '__global__';
const cacheKeyOf = (req) => req?.user?.tenantId || GLOBAL_KEY;

async function loadDbEndpointsCached(req) {
  const key = cacheKeyOf(req);
  const now = Date.now();
  const entry = cache.get(key);
  if (entry && now - entry.at < CACHE_TTL_MS) {
    return entry.endpoints;
  }
  const records = await listCustomEndpoints();
  const dbEndpoints =
    !records || records.length === 0
      ? []
      : dbRecordsToEndpoints(records.map((r) => ({ ...r, config: r.config })));
  cache.set(key, { at: now, endpoints: dbEndpoints });
  return dbEndpoints;
}

/**
 * Clears the cached DB-endpoint merge. The custom-endpoint controller
 * calls this after every successful create / update / delete so the
 * next request reflects the change immediately.
 */
function invalidateDbCustomEndpointsCache() {
  cache.clear();
}

const attachDbCustomEndpoints = async (req, _res, next) => {
  if (!req.config) {
    return next();
  }
  try {
    const dbEndpoints = await loadDbEndpointsCached(req);
    if (dbEndpoints.length === 0) return next();

    const yamlEndpoints = req.config.endpoints?.custom ?? [];
    const mergedCustom = mergeCustomEndpointsByName(yamlEndpoints, dbEndpoints);

    req.config = {
      ...req.config,
      endpoints: {
        ...(req.config.endpoints || {}),
        custom: mergedCustom,
      },
    };
    next();
  } catch (error) {
    logger.warn('[attachDbCustomEndpoints] failed to merge DB custom endpoints', {
      error: error?.message,
    });
    next();
  }
};

module.exports = attachDbCustomEndpoints;
module.exports.invalidateDbCustomEndpointsCache = invalidateDbCustomEndpointsCache;
module.exports._resetCacheForTests = () => cache.clear();
