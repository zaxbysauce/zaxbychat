import { memo } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { Button, TooltipAnchor } from '@librechat/client';
import type { TCustomEndpointResponse } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

interface Props {
  endpoint: TCustomEndpointResponse;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

function CustomEndpointCard({ endpoint, canEdit, onEdit, onDelete }: Props) {
  const localize = useLocalize();
  const isUserProvided = endpoint.config.apiKey === 'user_provided';

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded border border-border-light bg-surface-primary p-2',
      )}
      data-testid="custom-endpoint-card"
      data-name={endpoint.name}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{endpoint.name}</div>
        <div className="truncate text-xs text-text-secondary">{endpoint.config.baseURL}</div>
        <div className="text-xs text-text-secondary">
          {(endpoint.config.models?.default ?? []).join(', ') || '—'}
        </div>
        {isUserProvided && (
          <div className="mt-1 inline-block rounded bg-surface-tertiary px-1 text-[10px] uppercase">
            {localize('com_ui_custom_endpoint_user_key_chip')}
          </div>
        )}
      </div>
      {canEdit && (
        <div className="flex gap-1">
          <TooltipAnchor
            description={localize('com_ui_edit')}
            render={
              <Button
                variant="outline"
                size="icon"
                className="size-7"
                onClick={onEdit}
                aria-label={localize('com_ui_custom_endpoint_edit_aria', { 0: endpoint.name })}
              >
                <Pencil className="size-3" aria-hidden />
              </Button>
            }
          />
          <TooltipAnchor
            description={localize('com_ui_delete')}
            render={
              <Button
                variant="outline"
                size="icon"
                className="size-7"
                onClick={onDelete}
                aria-label={localize('com_ui_custom_endpoint_delete_aria', { 0: endpoint.name })}
                data-testid="custom-endpoint-delete"
              >
                <Trash2 className="size-3" aria-hidden />
              </Button>
            }
          />
        </div>
      )}
    </div>
  );
}

export default memo(CustomEndpointCard);
