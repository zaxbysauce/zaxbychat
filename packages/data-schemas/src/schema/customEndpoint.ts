import { Schema } from 'mongoose';
import type { CustomEndpointDocument } from '~/types';

/**
 * Phase 9 — DB-backed UI-managed custom AI endpoints.
 *
 * `name` is the canonical identifier (used by per-user keys via
 * SetKeyDialog and by the merged endpoint registry). The compound
 * unique index `(name, tenantId)` enforces uniqueness inside a
 * tenant; the YAML registry tier is checked first by the merge layer
 * so a YAML-defined entry with the same name shadows the DB one.
 *
 * `config` mirrors the YAML `endpoints.custom[*]` shape (`TEndpoint`)
 * exactly, plus an optional `capabilities` array consumed by Phase 2's
 * pre-Run gate.
 */
const customEndpointSchema = new Schema<CustomEndpointDocument>(
  {
    name: {
      type: String,
      index: true,
      required: true,
    },
    config: {
      type: Schema.Types.Mixed,
      required: true,
    },
    author: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    tenantId: {
      type: String,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

customEndpointSchema.index({ name: 1, tenantId: 1 }, { unique: true });
customEndpointSchema.index({ updatedAt: -1, _id: 1 });

export default customEndpointSchema;
