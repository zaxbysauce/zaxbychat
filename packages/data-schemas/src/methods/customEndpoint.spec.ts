/**
 * Phase 9 — DB-backed custom endpoint method tests.
 *
 * Verifies CRUD round-trips against a real in-memory MongoDB
 * (mongodb-memory-server). Each scenario reflects a flow the Phase 9
 * UI relies on:
 *   - create with explicit name (D-P9-7 mirrors YAML shape)
 *   - duplicate-name rejection inside the same tenant scope
 *   - find-by-name lookup used by the registry merge layer
 *   - list/list-by-author used by the SidePanel list view
 *   - update merges new config fields onto the existing record
 *   - delete returns deletedCount for caller-side response shaping
 */
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { TCustomEndpointConfig } from 'librechat-data-provider';
import type * as t from '~/types';
import { createCustomEndpointMethods } from './customEndpoint';
import customEndpointSchema from '~/schema/customEndpoint';

let mongoServer: MongoMemoryServer;
let CustomEndpoint: mongoose.Model<t.CustomEndpointDocument>;
let methods: ReturnType<typeof createCustomEndpointMethods>;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  CustomEndpoint =
    mongoose.models.CustomEndpoint ||
    mongoose.model('CustomEndpoint', customEndpointSchema);
  methods = createCustomEndpointMethods(mongoose);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
});

const baseConfig = (overrides: Partial<TCustomEndpointConfig> = {}): TCustomEndpointConfig =>
  ({
    name: 'ollama-local',
    apiKey: 'user_provided',
    baseURL: 'http://localhost:11434/v1',
    models: { default: ['llama3.1:8b'] },
    ...overrides,
  }) as TCustomEndpointConfig;

describe('CustomEndpoint methods — create', () => {
  it('creates a record with the supplied name + config', async () => {
    const author = new mongoose.Types.ObjectId();
    const created = await methods.createCustomEndpoint({
      name: 'ollama-local',
      config: baseConfig(),
      author,
    });
    expect(created.name).toBe('ollama-local');
    expect(created.config.baseURL).toBe('http://localhost:11434/v1');
    expect(created.author.toString()).toBe(author.toString());
    expect(created.createdAt).toBeInstanceOf(Date);
  });

  it('persists capabilities[] alongside the config', async () => {
    const author = new mongoose.Types.ObjectId();
    const config = baseConfig({
      capabilities: ['vision', 'tools'],
    } as Partial<TCustomEndpointConfig>);
    const created = await methods.createCustomEndpoint({
      name: 'cap-endpoint',
      config,
      author,
    });
    expect(created.config.capabilities).toEqual(['vision', 'tools']);
  });

  it('rejects duplicate names within the same tenant', async () => {
    // Mongoose builds indexes asynchronously by default; force the
    // unique (name, tenantId) index to exist before testing the
    // duplicate-key path. Mirror the pattern from mcpServer.spec.ts.
    await CustomEndpoint.ensureIndexes();
    const author = new mongoose.Types.ObjectId();
    await methods.createCustomEndpoint({
      name: 'dup',
      config: baseConfig(),
      author,
    });
    await expect(
      methods.createCustomEndpoint({
        name: 'dup',
        config: baseConfig(),
        author,
      }),
    ).rejects.toThrow();
  });
});

describe('CustomEndpoint methods — find / list', () => {
  it('finds a record by name', async () => {
    const author = new mongoose.Types.ObjectId();
    await methods.createCustomEndpoint({
      name: 'lookup-target',
      config: baseConfig(),
      author,
    });
    const found = await methods.findCustomEndpointByName('lookup-target');
    expect(found?.name).toBe('lookup-target');
  });

  it('returns null for non-existent name', async () => {
    expect(await methods.findCustomEndpointByName('missing')).toBeNull();
  });

  it('lists all records sorted by updatedAt desc', async () => {
    const author = new mongoose.Types.ObjectId();
    await methods.createCustomEndpoint({ name: 'a', config: baseConfig(), author });
    // Bump the gap so updatedAt differs even on slow CI workers.
    await new Promise((r) => setTimeout(r, 25));
    await methods.createCustomEndpoint({ name: 'b', config: baseConfig(), author });
    const all = await methods.listCustomEndpoints();
    expect(all.map((e) => e.name)).toEqual(['b', 'a']);
  });

  it('filters list by author', async () => {
    const a1 = new mongoose.Types.ObjectId();
    const a2 = new mongoose.Types.ObjectId();
    await methods.createCustomEndpoint({ name: 'mine', config: baseConfig(), author: a1 });
    await methods.createCustomEndpoint({ name: 'theirs', config: baseConfig(), author: a2 });
    const mine = await methods.listCustomEndpointsByAuthor(a1);
    expect(mine.map((e) => e.name)).toEqual(['mine']);
  });
});

describe('CustomEndpoint methods — update', () => {
  it('merges new fields onto the existing config', async () => {
    const author = new mongoose.Types.ObjectId();
    await methods.createCustomEndpoint({
      name: 'edit-target',
      config: baseConfig({ iconURL: 'https://example.test/a.png' } as Partial<TCustomEndpointConfig>),
      author,
    });
    const updated = await methods.updateCustomEndpoint('edit-target', {
      config: { baseURL: 'http://localhost:8080/v1' } as Partial<TCustomEndpointConfig>,
    });
    expect(updated?.config.baseURL).toBe('http://localhost:8080/v1');
    expect(updated?.config.iconURL).toBe('https://example.test/a.png');
    expect(updated?.config.apiKey).toBe('user_provided');
  });

  it('returns null when updating a non-existent name', async () => {
    const result = await methods.updateCustomEndpoint('nope', {
      config: { baseURL: 'http://x' } as Partial<TCustomEndpointConfig>,
    });
    expect(result).toBeNull();
  });
});

describe('CustomEndpoint methods — delete', () => {
  it('removes the record and reports deletedCount', async () => {
    const author = new mongoose.Types.ObjectId();
    await methods.createCustomEndpoint({
      name: 'gone',
      config: baseConfig(),
      author,
    });
    const result = await methods.deleteCustomEndpoint('gone');
    expect(result.deletedCount).toBe(1);
    expect(await methods.findCustomEndpointByName('gone')).toBeNull();
  });

  it('reports deletedCount=0 for non-existent name', async () => {
    expect((await methods.deleteCustomEndpoint('missing')).deletedCount).toBe(0);
  });
});
