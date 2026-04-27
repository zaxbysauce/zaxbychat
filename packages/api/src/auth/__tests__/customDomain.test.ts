/**
 * Phase 9 — permissive endpoint URL validation.
 *
 * Verifies the matrix the locked design promises:
 *   - localhost / 127.* / RFC1918 ranges permitted by default
 *   - cloud-metadata + internal service hostnames always blocked
 *   - file: / javascript: / data: / unparseable URLs always blocked
 *   - allowLocalAddresses: false falls through to strict SSRF rules
 *   - env-toggled mode (LIBRECHAT_STRICT_ENDPOINT_URLS) flips default
 */
import {
  validateCustomEndpointBaseUrl,
  shouldAllowLocalEndpointAddresses,
} from '../customDomain';

describe('validateCustomEndpointBaseUrl — schemes', () => {
  it('rejects unparseable URLs', () => {
    expect(validateCustomEndpointBaseUrl('not a url').ok).toBe(false);
    expect(validateCustomEndpointBaseUrl('').ok).toBe(false);
  });

  it('rejects file: / javascript: / data: schemes', () => {
    for (const url of [
      'file:///etc/passwd',
      'javascript:alert(1)',
      'data:text/plain,hi',
      'ftp://x.test/y',
    ]) {
      expect(validateCustomEndpointBaseUrl(url).ok).toBe(false);
    }
  });

  it('accepts http and https', () => {
    expect(validateCustomEndpointBaseUrl('http://api.example.test/v1').ok).toBe(true);
    expect(validateCustomEndpointBaseUrl('https://api.example.test/v1').ok).toBe(true);
  });
});

describe('validateCustomEndpointBaseUrl — local addresses (default permissive)', () => {
  for (const url of [
    'http://localhost:11434/v1',
    'http://localhost.localdomain/v1',
    'http://api.localhost/v1',
    'http://127.0.0.1/v1',
    'http://127.0.0.5:8000/v1',
    'http://10.0.0.1/v1',
    'http://172.16.5.5/v1',
    'http://172.31.255.1/v1',
    'http://192.168.1.50/v1',
  ]) {
    it(`permits ${url}`, () => {
      expect(validateCustomEndpointBaseUrl(url).ok).toBe(true);
    });
  }
});

describe('validateCustomEndpointBaseUrl — always-blocked targets', () => {
  it('blocks cloud-metadata IP', () => {
    expect(validateCustomEndpointBaseUrl('http://169.254.169.254/v1').ok).toBe(false);
  });

  it('blocks Google internal metadata', () => {
    expect(
      validateCustomEndpointBaseUrl('http://metadata.google.internal/v1').ok,
    ).toBe(false);
  });

  for (const host of ['mongodb', 'redis', 'rag_api', 'meilisearch']) {
    it(`blocks internal-service hostname ${host}`, () => {
      expect(validateCustomEndpointBaseUrl(`http://${host}:8000/v1`).ok).toBe(false);
    });
  }

  it('blocks .internal / .local TLDs', () => {
    expect(validateCustomEndpointBaseUrl('http://node.internal/v1').ok).toBe(false);
    expect(validateCustomEndpointBaseUrl('http://printer.local/v1').ok).toBe(false);
  });

  it('blocks bare-label internal / local hostnames (review M3)', () => {
    // `endsWith('.internal')` returns false for the bare string
    // 'internal'; without an explicit blocklist entry these slip past.
    expect(validateCustomEndpointBaseUrl('http://internal/v1').ok).toBe(false);
    expect(validateCustomEndpointBaseUrl('http://local/v1').ok).toBe(false);
  });
});

describe('validateCustomEndpointBaseUrl — strict mode', () => {
  it('rejects loopback / RFC1918 when allowLocalAddresses=false', () => {
    for (const url of [
      'http://localhost/v1',
      'http://127.0.0.1/v1',
      'http://10.0.0.1/v1',
      'http://192.168.1.1/v1',
    ]) {
      expect(
        validateCustomEndpointBaseUrl(url, { allowLocalAddresses: false }).ok,
      ).toBe(false);
    }
  });
});

describe('shouldAllowLocalEndpointAddresses', () => {
  it('defaults to true (permissive offline-single-user posture)', () => {
    expect(shouldAllowLocalEndpointAddresses({})).toBe(true);
  });

  it('true when LIBRECHAT_STRICT_ENDPOINT_URLS is unset/empty', () => {
    expect(shouldAllowLocalEndpointAddresses({ LIBRECHAT_STRICT_ENDPOINT_URLS: '' })).toBe(true);
  });

  it('false when LIBRECHAT_STRICT_ENDPOINT_URLS is truthy', () => {
    for (const v of ['true', 'TRUE', '1', 'yes', 'on', 'enabled']) {
      expect(shouldAllowLocalEndpointAddresses({ LIBRECHAT_STRICT_ENDPOINT_URLS: v })).toBe(
        false,
      );
    }
  });

  it('true when LIBRECHAT_STRICT_ENDPOINT_URLS is non-truthy string', () => {
    for (const v of ['false', 'no', 'off', '0', 'maybe']) {
      expect(shouldAllowLocalEndpointAddresses({ LIBRECHAT_STRICT_ENDPOINT_URLS: v })).toBe(
        true,
      );
    }
  });
});
