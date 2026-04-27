import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button, Spinner, FilterInput, TooltipAnchor } from '@librechat/client';
import { PermissionTypes, Permissions, SystemRoles } from 'librechat-data-provider';
import type { TCustomEndpointResponse } from 'librechat-data-provider';
import {
  useCustomEndpointsQuery,
  useDeleteCustomEndpointMutation,
} from '~/data-provider/CustomEndpoints';
import { useAuthContext, useHasAccess, useLocalize } from '~/hooks';
import CustomEndpointDialog from './CustomEndpointDialog';
import CustomEndpointCard from './CustomEndpointCard';

/**
 * Phase 9 — SidePanel for DB-backed custom AI endpoints. Anyone with
 * `CUSTOM_ENDPOINTS.USE` can see the list; `CREATE` gates the Add
 * button. Row-level edit/delete is enforced by the backend (admins
 * can edit any row; users can edit their own). The frontend pre-gates
 * with the same logic so the UI doesn't offer actions the server
 * will reject.
 */
export default function CustomEndpointsPanel() {
  const localize = useLocalize();
  const { user } = useAuthContext();
  const hasUseAccess = useHasAccess({
    permissionType: PermissionTypes.CUSTOM_ENDPOINTS,
    permission: Permissions.USE,
  });
  const hasCreateAccess = useHasAccess({
    permissionType: PermissionTypes.CUSTOM_ENDPOINTS,
    permission: Permissions.CREATE,
  });
  const hasUpdateAccess = useHasAccess({
    permissionType: PermissionTypes.CUSTOM_ENDPOINTS,
    permission: Permissions.UPDATE,
  });

  const { data: endpoints, isLoading } = useCustomEndpointsQuery({ enabled: hasUseAccess });
  const deleteMutation = useDeleteCustomEndpointMutation();

  const [editing, setEditing] = useState<TCustomEndpointResponse | undefined>(undefined);
  const [showDialog, setShowDialog] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const filtered = useMemo(() => {
    if (!endpoints) return [];
    if (!searchQuery.trim()) return endpoints;
    const q = searchQuery.toLowerCase();
    return endpoints.filter(
      (e) => e.name.toLowerCase().includes(q) || e.config.baseURL.toLowerCase().includes(q),
    );
  }, [endpoints, searchQuery]);

  const isAdmin = user?.role === SystemRoles.ADMIN;
  const canEditRow = (record: TCustomEndpointResponse): boolean => {
    if (!hasUpdateAccess) return false;
    if (isAdmin) return true;
    if (!record.author || !user?.id) return false;
    return record.author === user.id;
  };

  const onAdd = () => {
    setEditing(undefined);
    setShowDialog(true);
  };

  const onEdit = (record: TCustomEndpointResponse) => {
    setEditing(record);
    setShowDialog(true);
  };

  const onDelete = (record: TCustomEndpointResponse) => {
    deleteMutation.mutate(record.name);
  };

  if (!hasUseAccess) return null;

  const renderList = () => {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center p-8">
          <Spinner className="size-6" aria-label={localize('com_ui_loading')} />
        </div>
      );
    }
    if (filtered.length === 0) {
      return (
        <p className="px-2 py-4 text-center text-sm text-text-secondary">
          {searchQuery
            ? localize('com_ui_custom_endpoint_none_match')
            : localize('com_ui_custom_endpoint_empty')}
        </p>
      );
    }
    return (
      <div className="flex flex-col gap-2">
        {filtered.map((endpoint) => (
          <CustomEndpointCard
            key={endpoint.name}
            endpoint={endpoint}
            canEdit={canEditRow(endpoint)}
            onEdit={() => onEdit(endpoint)}
            onDelete={() => onDelete(endpoint)}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="flex h-auto w-full flex-col px-3 pb-3">
      <div role="region" aria-label={localize('com_ui_custom_endpoints')} className="space-y-2">
        <div className="flex items-center gap-2">
          <FilterInput
            inputId="custom-endpoint-filter"
            label={localize('com_ui_custom_endpoint_filter')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            containerClassName="flex-1"
          />
          {hasCreateAccess && (
            <TooltipAnchor
              description={localize('com_ui_custom_endpoint_add')}
              side="bottom"
              render={
                <Button
                  variant="outline"
                  size="icon"
                  className="size-9 shrink-0 bg-transparent"
                  onClick={onAdd}
                  aria-label={localize('com_ui_custom_endpoint_add')}
                  data-testid="custom-endpoint-add"
                >
                  <Plus className="size-4" aria-hidden />
                </Button>
              }
            />
          )}
        </div>

        {renderList()}
      </div>

      <CustomEndpointDialog open={showDialog} onOpenChange={setShowDialog} existing={editing} />
    </div>
  );
}
