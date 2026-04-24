import { councilAgentsSchema, validateCouncilComposition } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type { CouncilAgentSpec } from 'librechat-data-provider';

/**
 * Primary leg shape the activation decision inspects. Kept as a structural
 * subset of whatever the request context offers, so this helper stays
 * independent of the request object layout.
 */
export interface CouncilPrimaryLeg {
  endpoint: string;
  model: string;
  agent_id?: string | null;
}

export type CouncilActivationReason =
  | { status: 'active' }
  | { status: 'flag_off' }
  | { status: 'no_extras' }
  | { status: 'invalid_extras'; issue: string }
  | { status: 'duplicate_leg'; info: string }
  | { status: 'too_many_extras'; info: string };

/**
 * Single source of truth for "should council mode run for this request?"
 *
 * Gates:
 *   1. interfaceSchema.council must be `true` (Phase 4 design §D4).
 *   2. councilAgents (extras) must be a valid array per councilAgentsSchema.
 *   3. Composition must be unique and within MAX_COUNCIL_EXTRAS (§D8).
 *
 * Returns `{ status: 'active' }` only when all three hold. Every non-active
 * status carries a structured reason so callers can log accurately or surface
 * a specific `ErrorTypes.*` to clients.
 *
 * Important: an empty extras array returns `'no_extras'`, not `'active'` —
 * council mode requires at least one extra leg to be meaningful.
 */
export function evaluateCouncilActivation(params: {
  appConfig?: AppConfig;
  councilAgents?: unknown;
  primary: CouncilPrimaryLeg;
}): CouncilActivationReason {
  const { appConfig, councilAgents, primary } = params;

  const flag = appConfig?.interfaceConfig?.council;
  if (flag !== true) {
    return { status: 'flag_off' };
  }

  const parsed = councilAgentsSchema.safeParse(councilAgents);
  if (!parsed.success) {
    return { status: 'invalid_extras', issue: parsed.error.issues.map((i) => i.message).join('; ') };
  }

  const extras: CouncilAgentSpec[] = parsed.data;
  if (extras.length === 0) {
    return { status: 'no_extras' };
  }

  const composition = validateCouncilComposition({ primary, extras });
  if (composition?.reason === 'duplicate_leg') {
    return { status: 'duplicate_leg', info: composition.info };
  }
  if (composition?.reason === 'too_many_extras') {
    return { status: 'too_many_extras', info: composition.info };
  }

  return { status: 'active' };
}

/**
 * Returns the validated extras array for an active council activation, or
 * null when activation's status is anything other than `'active'`. Convenience
 * wrapper for callers that only care about the happy path.
 */
export function resolveCouncilExtras(params: {
  appConfig?: AppConfig;
  councilAgents?: unknown;
  primary: CouncilPrimaryLeg;
}): CouncilAgentSpec[] | null {
  const result = evaluateCouncilActivation(params);
  if (result.status !== 'active') {
    return null;
  }
  return councilAgentsSchema.parse(params.councilAgents);
}
