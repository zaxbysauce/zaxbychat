/**
 * Phase 9 — DB-backed custom AI endpoint routes.
 *
 * `GET    /api/custom-endpoints`         list visible to user (USE)
 * `POST   /api/custom-endpoints/test`    Test Connection (USE)
 * `POST   /api/custom-endpoints`         create (USE + CREATE)
 * `PATCH  /api/custom-endpoints/:name`   update (USE + UPDATE; owner or admin)
 * `DELETE /api/custom-endpoints/:name`   delete (USE + UPDATE; owner or admin)
 *
 * Permission gating uses the standard `generateCheckAccess` factory
 * with `PermissionTypes.CUSTOM_ENDPOINTS`. Both ADMIN and USER roles
 * are granted USE/CREATE/UPDATE by default (D-P9-1) so a single-user
 * offline deployment lets normal users manage endpoints. Row-level
 * ownership for update / delete is enforced inside the controller.
 *
 * Review M1: DELETE shares UPDATE's role gate so a user role granted
 * USE-only (e.g. read-only viewer) cannot delete records, while
 * still allowing owners + admins to delete (controller-level check).
 */
const { Router } = require('express');
const { generateCheckAccess } = require('@librechat/api');
const { PermissionTypes, Permissions } = require('librechat-data-provider');
const { requireJwtAuth } = require('~/server/middleware');
// `~/db` exports only `{connectDb, indexSync}`. Role lookups live on
// `~/models` — the same path used by every sibling route (mcp,
// memories, tags, prompts). Importing `getRoleByName` from `~/db`
// makes it `undefined`, and `generateCheckAccess` throws on first
// authed request with a 500 (Phase 9 follow-up).
const db = require('~/models');
const {
  listEndpoints,
  createEndpoint,
  updateEndpoint,
  deleteEndpoint,
  testEndpoint,
} = require('~/server/controllers/customEndpoints');

const router = Router();

const checkUse = generateCheckAccess({
  permissionType: PermissionTypes.CUSTOM_ENDPOINTS,
  permissions: [Permissions.USE],
  getRoleByName: db.getRoleByName,
});

const checkCreate = generateCheckAccess({
  permissionType: PermissionTypes.CUSTOM_ENDPOINTS,
  permissions: [Permissions.USE, Permissions.CREATE],
  getRoleByName: db.getRoleByName,
});

const checkUpdate = generateCheckAccess({
  permissionType: PermissionTypes.CUSTOM_ENDPOINTS,
  permissions: [Permissions.USE, Permissions.UPDATE],
  getRoleByName: db.getRoleByName,
});

router.get('/', requireJwtAuth, checkUse, listEndpoints);
router.post('/test', requireJwtAuth, checkUse, testEndpoint);
router.post('/', requireJwtAuth, checkCreate, createEndpoint);
router.patch('/:name', requireJwtAuth, checkUpdate, updateEndpoint);
router.delete('/:name', requireJwtAuth, checkUpdate, deleteEndpoint);

module.exports = router;
