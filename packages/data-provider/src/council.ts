import { z } from 'zod';

/**
 * A single extra leg in a council-mode request.
 *
 * Semantics are **extras-only**: the primary leg is always the currently
 * selected `endpointOption.endpoint` + `endpointOption.model`, NEVER included
 * in this array. `councilAgents` represents the set of additional legs to run
 * in parallel with the primary.
 *
 * The shape is deliberately narrower than `endpointOption.addedConvo`:
 * council extras do not carry per-leg prompt / tool / spec overrides. Users
 * needing richer per-leg customization continue to use `addedConvo`
 * (unchanged under the Phase 4 design's D1 decision).
 */
export type CouncilAgentSpec = {
  endpoint: string;
  model: string;
  agent_id?: string;
};

export const councilAgentSpecSchema = z.object({
  endpoint: z.string().min(1),
  model: z.string().min(1),
  agent_id: z.string().optional(),
});

/**
 * Council-extras array: up to 2 entries, giving a total council size
 * (primary + extras) of at most 3. See Phase 4 design §D8.
 */
export const MAX_COUNCIL_EXTRAS = 2;

export const councilAgentsSchema = z.array(councilAgentSpecSchema).max(MAX_COUNCIL_EXTRAS);

/**
 * Identifier used when constructing the synthesis node and its per-run
 * AbortController child. Chosen so it never collides with a real agent id
 * produced by `appendAgentIdSuffix` or `encodeEphemeralAgentId`.
 */
export const SYNTHESIS_AGENT_ID = '__synthesis__';

/**
 * Three synthesis strategies recognized by the graph. See Phase 4 design §D6.
 */
export const synthesisStrategySchema = z.enum([
  'primary_critic',
  'best_of_three',
  'compare_and_synthesize',
]);

export type SynthesisStrategy = z.infer<typeof synthesisStrategySchema>;

export const DEFAULT_SYNTHESIS_STRATEGY: SynthesisStrategy = 'compare_and_synthesize';

/**
 * Produces a stable fingerprint for a council leg to detect cross-array
 * duplicates. `agent_id` of `undefined` is distinct from any concrete id.
 */
export function councilLegFingerprint(leg: {
  endpoint: string;
  model: string;
  agent_id?: string | null;
}): string {
  const agentId = leg.agent_id == null ? '' : leg.agent_id;
  return `${leg.endpoint}${leg.model}${agentId}`;
}

export interface CouncilUniquenessIssue {
  reason: 'duplicate_leg' | 'too_many_extras';
  info: string;
}

/**
 * Validates uniqueness and size of the council composition. Returns null when
 * valid, or a structured issue otherwise. Callers translate the issue into
 * the appropriate `ErrorTypes.*` rejection.
 */
export function validateCouncilComposition(params: {
  primary: { endpoint: string; model: string; agent_id?: string | null };
  extras: CouncilAgentSpec[];
}): CouncilUniquenessIssue | null {
  const { primary, extras } = params;
  if (extras.length > MAX_COUNCIL_EXTRAS) {
    return {
      reason: 'too_many_extras',
      info: `received ${extras.length} extras; max is ${MAX_COUNCIL_EXTRAS}`,
    };
  }
  const seen = new Set<string>();
  seen.add(councilLegFingerprint(primary));
  for (let i = 0; i < extras.length; i++) {
    const fp = councilLegFingerprint(extras[i]);
    if (seen.has(fp)) {
      return {
        reason: 'duplicate_leg',
        info: `extras[${i}] duplicates an earlier leg (${extras[i].endpoint}/${extras[i].model})`,
      };
    }
    seen.add(fp);
  }
  return null;
}
