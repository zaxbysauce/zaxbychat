import customEndpointSchema from '~/schema/customEndpoint';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import type { CustomEndpointDocument } from '~/types';

export function createCustomEndpointModel(mongoose: typeof import('mongoose')) {
  applyTenantIsolation(customEndpointSchema);
  return (
    mongoose.models.CustomEndpoint ||
    mongoose.model<CustomEndpointDocument>('CustomEndpoint', customEndpointSchema)
  );
}
