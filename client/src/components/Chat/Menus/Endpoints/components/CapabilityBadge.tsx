import React from 'react';
import { BadgeCheck, Sparkles, CircleHelp } from 'lucide-react';
import type { CapabilityResolution } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

interface CapabilityBadgeProps {
  resolution: CapabilityResolution;
  className?: string;
}

/**
 * Small indicator shown next to a model's name in selector surfaces, honestly
 * reflecting the capability resolution source (explicit / inferred / unknown).
 * Tooltip text is always localized.
 */
export function CapabilityBadge({ resolution, className }: CapabilityBadgeProps) {
  const localize = useLocalize();

  if (resolution.source === 'explicit') {
    return (
      <BadgeCheck
        aria-label={localize('com_ui_capability_confirmed')}
        className={cn('ml-1 size-4 text-surface-submit', className)}
      />
    );
  }

  if (resolution.source === 'inferred') {
    return (
      <Sparkles
        aria-label={localize('com_ui_capability_inferred', { 0: resolution.matchedPattern })}
        className={cn('ml-1 size-4 text-amber-500', className)}
      />
    );
  }

  return (
    <CircleHelp
      aria-label={localize('com_ui_capability_unknown')}
      className={cn('ml-1 size-4 text-text-tertiary', className)}
    />
  );
}
