import { useMemo } from 'react';
import { resolveCapabilities } from 'librechat-data-provider';
import type { CapabilityResolution } from 'librechat-data-provider';
import { useGetStartupConfig } from '~/data-provider';

/**
 * Resolves a (provider, model) pair to a {@link CapabilityResolution} using the
 * operator-configured model specs when present and the shared conservative
 * inference table otherwise. Unknown is surfaced honestly as its own state.
 */
export default function useCapabilityResolution(
  provider: string | undefined,
  model: string | undefined,
): CapabilityResolution {
  const { data: startupConfig } = useGetStartupConfig();
  const specs = startupConfig?.modelSpecs?.list;

  return useMemo(() => {
    if (!provider || !model) {
      return { source: 'unknown' };
    }
    return resolveCapabilities(provider, model, specs);
  }, [provider, model, specs]);
}
