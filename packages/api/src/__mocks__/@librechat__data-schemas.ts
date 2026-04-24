export const CANCEL_RATE = 1.15;
export const SYSTEM_TENANT_ID = 'system';

export const logger = {
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
};

export const tenantStorage = {
  getStore: jest.fn().mockReturnValue(undefined),
  run: jest.fn((_store: unknown, fn: () => unknown) => fn()),
};

export function getTenantId(): string | undefined {
  return undefined;
}

export const createMethods = jest.fn();
export const decrypt = jest.fn();
export const decryptV2 = jest.fn();
export const encryptV2 = jest.fn();
export const escapeRegExp = jest.fn((s: string) => s);
export const getRandomValues = jest.fn();
export const hashToken = jest.fn();
export const isValidObjectIdString = jest.fn((s: string) => /^[0-9a-f]{24}$/i.test(s));
export const permissionBitSupersets = {};
export const webSearchAuth = jest.fn();
export const webSearchKeys = {};
export const AllMethods = {};
export class RoleConflictError extends Error {}
