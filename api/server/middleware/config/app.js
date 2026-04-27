const { logger } = require('@librechat/data-schemas');
const { getAppConfig } = require('~/server/services/Config');
const attachDbCustomEndpoints = require('./customEndpoints');

/**
 * Phase 9 — calls `attachDbCustomEndpoints` inline after `req.config`
 * is set. Consolidating it here means every existing route that
 * mounts `configMiddleware` automatically picks up DB-backed custom
 * endpoints without per-route wiring.
 */
async function applyDbCustomEndpoints(req) {
  await new Promise((resolve, reject) => {
    attachDbCustomEndpoints(req, undefined, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

const configMiddleware = async (req, res, next) => {
  try {
    const userRole = req.user?.role;
    const userId = req.user?.id;
    const tenantId = req.user?.tenantId;
    req.config = await getAppConfig({ role: userRole, userId, tenantId });
    await applyDbCustomEndpoints(req);
    next();
  } catch (error) {
    logger.error('Config middleware error:', {
      error: error.message,
      userRole: req.user?.role,
      path: req.path,
    });

    try {
      req.config = await getAppConfig({ tenantId: req.user?.tenantId });
      await applyDbCustomEndpoints(req);
      next();
    } catch (fallbackError) {
      logger.error('Fallback config middleware error:', fallbackError);
      next(fallbackError);
    }
  }
};

module.exports = configMiddleware;
