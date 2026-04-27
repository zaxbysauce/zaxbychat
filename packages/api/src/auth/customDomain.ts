/**
 * Phase 9 — permissive URL validation for DB-backed custom AI endpoints.
 *
 * The strict `validateEndpointURL` exported from `./domain` blocks
 * every private/loopback/internal-service hostname unconditionally.
 * That posture is correct for multi-tenant production (defense in
 * depth against SSRF), but it makes a single-user offline deployment
 * unable to register `http://localhost:11434/v1`, `http://192.168.1.50/v1`,
 * etc. — exactly the use-case Phase 9 targets.
 *
 * This sibling validator keeps the structural defenses
 * (HTTP/HTTPS-only, no `file:`/`javascript:`/`data:`, parseable URL,
 * cloud-metadata IPs and known internal-service hostnames still
 * blocked) but permits common loopback / RFC1918 ranges by default.
 *
 * Strict-mode opt-back is wired through the env var
 * `LIBRECHAT_STRICT_ENDPOINT_URLS=true`; in that mode the helper
 * delegates to the original `validateEndpointURL`.
 */

import { isPrivateIP, isSSRFTarget } from './domain';

const ALWAYS_BLOCKED_HOSTNAMES = new Set([
  '169.254.169.254',
  '169.254.170.2',
  'metadata.google.internal',
  'metadata',
  'mongodb',
  'redis',
  'rag_api',
  'meilisearch',
  'postgres',
  'elasticsearch',
  'kibana',
  // Bare-label internal hostnames — review M3. Without this, the
  // suffix-based check below fails on `internal` / `local` because
  // `endsWith('.internal')` rejects bare strings.
  'internal',
  'local',
]);

const ALWAYS_BLOCKED_TLDS = ['.internal', '.local'];

const LOOPBACK_OR_PRIVATE_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
]);

const LOOPBACK_PRIVATE_IPV4 =
  /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/;

function isPermittedLocalAddress(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (LOOPBACK_OR_PRIVATE_HOSTNAMES.has(h)) return true;
  if (h.endsWith('.localhost')) return true;
  if (h === '::1' || h === '[::1]') return true;
  if (LOOPBACK_PRIVATE_IPV4.test(h)) return true;
  return false;
}

function isAlwaysBlocked(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (ALWAYS_BLOCKED_HOSTNAMES.has(h)) return true;
  for (const tld of ALWAYS_BLOCKED_TLDS) {
    if (h.endsWith(tld)) return true;
  }
  return false;
}

export interface CustomEndpointUrlValidationOptions {
  /**
   * When true (default), permits loopback + RFC1918 private ranges.
   * When false, falls through to the strict SSRF gate (every private
   * range blocked). Defaults to true for the offline-single-user
   * deployment posture; multi-tenant operators set
   * `LIBRECHAT_STRICT_ENDPOINT_URLS=true` (read by the caller).
   */
  allowLocalAddresses?: boolean;
}

export type CustomEndpointUrlValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Synchronous structural validation of a candidate endpoint baseURL.
 * Always blocks malicious schemes and known-internal targets; permits
 * loopback/RFC1918 by default. Returns a discriminated result rather
 * than throwing, so route handlers can map to HTTP responses without
 * try/catch.
 */
export function validateCustomEndpointBaseUrl(
  url: string,
  options: CustomEndpointUrlValidationOptions = {},
): CustomEndpointUrlValidationResult {
  const allowLocal = options.allowLocalAddresses ?? true;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'Base URL is not a parseable URL' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'Base URL must use http:// or https://' };
  }
  const hostname = parsed.hostname;
  if (!hostname) {
    return { ok: false, reason: 'Base URL has no hostname' };
  }
  if (isAlwaysBlocked(hostname)) {
    return { ok: false, reason: `Base URL targets a blocked address (${hostname})` };
  }
  if (allowLocal && isPermittedLocalAddress(hostname)) {
    return { ok: true };
  }
  if (isSSRFTarget(hostname)) {
    return { ok: false, reason: `Base URL targets a restricted address (${hostname})` };
  }
  if (typeof isPrivateIP === 'function' && isPrivateIP(hostname)) {
    return { ok: false, reason: `Base URL resolves to a private IP (${hostname})` };
  }
  return { ok: true };
}

/**
 * Reads the deployment-mode env var to decide whether to permit
 * loopback/private addresses. Default: permissive (offline
 * single-user). Truthy `LIBRECHAT_STRICT_ENDPOINT_URLS` flips to the
 * strict posture used by web-search and OAuth flows.
 */
export function shouldAllowLocalEndpointAddresses(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.LIBRECHAT_STRICT_ENDPOINT_URLS;
  if (typeof raw !== 'string') return true;
  const lowered = raw.trim().toLowerCase();
  const truthy = new Set(['1', 'true', 'yes', 'on', 'enabled']);
  return !truthy.has(lowered);
}
