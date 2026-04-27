import type { Model, Types } from 'mongoose';
import type { TCustomEndpointConfig } from 'librechat-data-provider';
import type { CustomEndpointDocument } from '~/types';
import logger from '~/config/winston';

const MAX_CREATE_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 25;
const LIST_HARD_LIMIT = 500;

/** Mongo duplicate-key (E11000) detector — name collisions on create. */
function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: number }).code === 11000
  );
}

export function createCustomEndpointMethods(mongoose: typeof import('mongoose')) {
  function model(): Model<CustomEndpointDocument> {
    return mongoose.models.CustomEndpoint as Model<CustomEndpointDocument>;
  }

  /**
   * Create a DB-backed custom endpoint. The caller supplies `name`
   * explicitly (per D-P9-7 the YAML shape is mirrored). On collision
   * with an existing entry of the same name+tenant, retries briefly
   * to cover transient TOCTOU between a precheck and `create()`.
   */
  async function createCustomEndpoint(data: {
    name: string;
    config: TCustomEndpointConfig;
    author: string | Types.ObjectId;
    tenantId?: string;
  }): Promise<CustomEndpointDocument> {
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_CREATE_RETRIES; attempt++) {
      try {
        const created = await model().create({
          name: data.name,
          config: data.config,
          author: data.author,
          ...(data.tenantId ? { tenantId: data.tenantId } : {}),
        });
        return created.toObject() as CustomEndpointDocument;
      } catch (error) {
        lastError = error;
        if (!isDuplicateKeyError(error)) throw error;
        if (attempt === MAX_CREATE_RETRIES - 1) {
          logger.warn(
            `[createCustomEndpoint] Duplicate name "${data.name}" after ${MAX_CREATE_RETRIES} attempts`,
          );
          throw error;
        }
        await new Promise((r) => setTimeout(r, RETRY_BASE_DELAY_MS * Math.pow(2, attempt)));
      }
    }
    throw lastError;
  }

  async function findCustomEndpointByName(
    name: string,
    tenantId?: string,
  ): Promise<CustomEndpointDocument | null> {
    return model()
      .findOne({ name, ...(tenantId ? { tenantId } : {}) })
      .lean();
  }

  /**
   * List all DB-backed custom endpoints visible to the caller.
   * Tenant-scoped via the existing `applyTenantIsolation` plugin;
   * authoring is enforced at the route layer. Capped at
   * `LIST_HARD_LIMIT` records (review M7) to prevent an unbounded
   * response from a single request.
   */
  async function listCustomEndpoints(): Promise<CustomEndpointDocument[]> {
    return model().find({}).sort({ updatedAt: -1 }).limit(LIST_HARD_LIMIT).lean();
  }

  async function listCustomEndpointsByAuthor(
    authorId: string | Types.ObjectId,
  ): Promise<CustomEndpointDocument[]> {
    return model()
      .find({ author: authorId })
      .sort({ updatedAt: -1 })
      .limit(LIST_HARD_LIMIT)
      .lean();
  }

  async function updateCustomEndpoint(
    name: string,
    update: { config?: Partial<TCustomEndpointConfig> },
    tenantId?: string,
  ): Promise<CustomEndpointDocument | null> {
    const existing = await model()
      .findOne({ name, ...(tenantId ? { tenantId } : {}) })
      .lean();
    if (!existing) return null;
    const merged = { ...existing.config, ...(update.config ?? {}) };
    return model()
      .findOneAndUpdate(
        { name, ...(tenantId ? { tenantId } : {}) },
        { $set: { config: merged } },
        { new: true },
      )
      .lean();
  }

  async function deleteCustomEndpoint(
    name: string,
    tenantId?: string,
  ): Promise<{ deletedCount: number }> {
    const result = await model().deleteOne({
      name,
      ...(tenantId ? { tenantId } : {}),
    });
    return { deletedCount: result.deletedCount ?? 0 };
  }

  return {
    createCustomEndpoint,
    findCustomEndpointByName,
    listCustomEndpoints,
    listCustomEndpointsByAuthor,
    updateCustomEndpoint,
    deleteCustomEndpoint,
  };
}

export type CustomEndpointMethods = ReturnType<typeof createCustomEndpointMethods>;
