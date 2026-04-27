import {
  PermissionTypes,
  permissionsSchema,
  PERMISSION_TYPE_INTERFACE_FIELDS,
} from './permissions';

/**
 * Phase 9 follow-up — parity guards. The original Phase 9 bug shape was
 * a new `PermissionTypes` enum value silently missing from a sibling
 * map (in that case the Mongoose `rolePermissionsSchema`). These specs
 * assert the equivalent parity for the data-provider-side maps so the
 * same class of drift fails CI rather than landing in production.
 */
describe('PermissionTypes parity', () => {
  it.each(Object.values(PermissionTypes))(
    'permissionsSchema declares a sub-schema for PermissionType %s',
    (permissionType) => {
      expect(permissionsSchema.shape).toHaveProperty(permissionType);
    },
  );

  it.each(Object.values(PermissionTypes))(
    'PERMISSION_TYPE_INTERFACE_FIELDS maps PermissionType %s to a non-empty string',
    (permissionType) => {
      const field = PERMISSION_TYPE_INTERFACE_FIELDS[permissionType];
      expect(typeof field).toBe('string');
      expect(field.length).toBeGreaterThan(0);
    },
  );

  it('PERMISSION_TYPE_INTERFACE_FIELDS values are unique', () => {
    const values = Object.values(PERMISSION_TYPE_INTERFACE_FIELDS);
    expect(new Set(values).size).toBe(values.length);
  });
});
