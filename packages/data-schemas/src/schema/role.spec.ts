import { PermissionTypes } from 'librechat-data-provider';
import roleSchema from './role';

/**
 * Phase 9 follow-up: a permission type added to the `PermissionTypes` enum
 * but not to the Mongoose `rolePermissionsSchema` is silently dropped on
 * `.save()` because Mongoose strict mode rejects undeclared fields. This
 * caused the Phase 9 CUSTOM_ENDPOINTS gate to evaluate false post-restart
 * (the field was wiped from the DB on every boot of `initializeRoles`),
 * hiding the SidePanel link in the UI.
 *
 * This spec asserts every enum value has a corresponding sub-schema entry
 * so the same class of bug fails CI rather than the deployed UI.
 */
describe('role schema — PermissionTypes parity', () => {
  const permissionsTree = (
    roleSchema.path('permissions') as unknown as { schema: { tree: Record<string, unknown> } }
  ).schema.tree;

  it.each(Object.values(PermissionTypes))(
    'declares a Mongoose sub-schema entry for PermissionType %s',
    (permissionType) => {
      expect(permissionsTree).toHaveProperty(permissionType);
    },
  );
});
