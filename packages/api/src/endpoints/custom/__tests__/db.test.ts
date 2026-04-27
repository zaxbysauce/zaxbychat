/**
 * Phase 9 — DB ↔ YAML merge tests.
 *
 * Locks under verification:
 *   D-P9-2 — YAML wins on name collision.
 *   D-P9-7 — DB records that don't validate as TEndpoint shape are skipped.
 */
import { dbRecordToEndpoint, dbRecordsToEndpoints, mergeCustomEndpointsByName } from '../db';
import type { ICustomEndpointDB, TEndpoint } from 'librechat-data-provider';

const validConfig = (over: Partial<TEndpoint> = {}): TEndpoint =>
  ({
    name: 'ollama-local',
    apiKey: 'user_provided',
    baseURL: 'http://localhost:11434/v1',
    models: { default: ['llama3.1:8b'] },
    ...over,
  }) as TEndpoint;

describe('dbRecordToEndpoint', () => {
  it('returns the config for a valid record', () => {
    const rec: ICustomEndpointDB = {
      name: 'ollama-local',
      config: validConfig(),
    };
    const e = dbRecordToEndpoint(rec);
    expect(e?.name).toBe('ollama-local');
  });

  it('rejects records with empty config', () => {
    expect(dbRecordToEndpoint({ name: 'x', config: undefined as never })).toBeNull();
  });

  it('rejects records missing baseURL or apiKey', () => {
    expect(
      dbRecordToEndpoint({
        name: 'x',
        config: { ...validConfig(), apiKey: '' } as TEndpoint,
      }),
    ).toBeNull();
    expect(
      dbRecordToEndpoint({
        name: 'x',
        config: { ...validConfig(), baseURL: '' } as TEndpoint,
      }),
    ).toBeNull();
  });

  it('rejects records with no fetch and no default models', () => {
    expect(
      dbRecordToEndpoint({
        name: 'x',
        config: {
          ...validConfig(),
          models: { default: [], fetch: false },
        } as TEndpoint,
      }),
    ).toBeNull();
  });

  it('accepts records with models.fetch=true even without default[]', () => {
    expect(
      dbRecordToEndpoint({
        name: 'fetcher',
        config: {
          ...validConfig({ name: 'fetcher' }),
          models: { default: [], fetch: true },
        } as TEndpoint,
      }),
    ).not.toBeNull();
  });
});

describe('dbRecordsToEndpoints', () => {
  it('preserves order and drops invalid records', () => {
    const out = dbRecordsToEndpoints([
      { name: 'a', config: validConfig({ name: 'a' }) },
      { name: 'b', config: { ...validConfig(), apiKey: '' } as TEndpoint },
      { name: 'c', config: validConfig({ name: 'c' }) },
    ]);
    expect(out.map((e) => e.name)).toEqual(['a', 'c']);
  });
});

describe('mergeCustomEndpointsByName — D-P9-2 YAML precedence', () => {
  it('returns YAML alone when DB is empty', () => {
    const yaml = [validConfig({ name: 'a' })];
    expect(mergeCustomEndpointsByName(yaml, []).map((e) => e.name)).toEqual(['a']);
  });

  it('returns DB alone when YAML is empty', () => {
    const db = [validConfig({ name: 'a' })];
    expect(mergeCustomEndpointsByName([], db).map((e) => e.name)).toEqual(['a']);
  });

  it('drops DB entries whose normalised name collides with YAML', () => {
    const yaml = [validConfig({ name: 'ollama-local' })];
    const db = [
      validConfig({ name: 'ollama-local', baseURL: 'http://192.168.1.5/v1' }),
      validConfig({ name: 'mistral', baseURL: 'http://192.168.1.6/v1' }),
    ];
    const merged = mergeCustomEndpointsByName(yaml, db);
    expect(merged).toHaveLength(2);
    expect(merged[0].baseURL).toBe('http://localhost:11434/v1');
    expect(merged[1].name).toBe('mistral');
  });

  it('treats Ollama / ollama as colliding (normalizeEndpointName special-case)', () => {
    const yaml = [validConfig({ name: 'Ollama' })];
    const db = [validConfig({ name: 'ollama', baseURL: 'http://192.168.1.5/v1' })];
    const merged = mergeCustomEndpointsByName(yaml, db);
    expect(merged).toHaveLength(1);
    expect(merged[0].baseURL).toBe('http://localhost:11434/v1');
  });

  it('treats case-mismatched names as colliding (review M9)', () => {
    // `normalizeEndpointName` only special-cases Ollama; the merge
    // adds a generic case-insensitive comparison so MyEndpoint and
    // myendpoint don't both surface in the dropdown.
    const yaml = [validConfig({ name: 'MyEndpoint' })];
    const db = [validConfig({ name: 'myendpoint', baseURL: 'http://192.168.1.5/v1' })];
    const merged = mergeCustomEndpointsByName(yaml, db);
    expect(merged).toHaveLength(1);
    expect(merged[0].baseURL).toBe('http://localhost:11434/v1');
    expect(merged[0].name).toBe('MyEndpoint');
  });

  it('preserves capabilities[] from DB entries through the merge (review M4)', () => {
    const yaml: Array<TEndpoint> = [];
    const db = [
      {
        ...validConfig({ name: 'cap-test' }),
        capabilities: ['vision', 'tools'],
      } as unknown as TEndpoint,
    ];
    const merged = mergeCustomEndpointsByName(yaml, db);
    expect(merged).toHaveLength(1);
    // Type widening preserves capabilities at runtime.
    expect((merged[0] as { capabilities?: string[] }).capabilities).toEqual([
      'vision',
      'tools',
    ]);
  });

  it('preserves YAML order, then non-colliding DB entries in order', () => {
    const yaml = [validConfig({ name: 'a' }), validConfig({ name: 'b' })];
    const db = [
      validConfig({ name: 'b' }),
      validConfig({ name: 'c' }),
      validConfig({ name: 'd' }),
    ];
    expect(
      mergeCustomEndpointsByName(yaml, db).map((e) => e.name),
    ).toEqual(['a', 'b', 'c', 'd']);
  });
});
