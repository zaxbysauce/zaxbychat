import type { Document, Types } from 'mongoose';
import type { ICustomEndpointDB } from 'librechat-data-provider';

/**
 * Phase 9 — Mongoose document for a DB-backed UI-managed custom AI endpoint.
 * Mirrors `ICustomEndpointDB` from data-provider; `_id` becomes the
 * ObjectId at the DB layer and `author` is required for ownership ACL.
 */
export interface CustomEndpointDocument
  extends Omit<ICustomEndpointDB, 'author' | '_id' | 'tenantId'>,
    Document<Types.ObjectId> {
  author: Types.ObjectId;
  tenantId?: string;
}
