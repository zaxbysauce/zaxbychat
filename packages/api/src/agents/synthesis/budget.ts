import type {
  CouncilAgentSpec,
  SynthesisStrategy,
} from 'librechat-data-provider';
import { getModelMaxOutputTokens } from '../../utils/tokens';

export interface PerLegEstimate {
  endpoint: string;
  model: string;
  /** Conservative upper bound on tokens the leg may emit. */
  estimatedCompletionTokens: number;
}

export interface SynthesisEstimate {
  /** Model used for synthesis — currently the primary. */
  endpoint: string;
  model: string;
  /** Bytes of leg output the synthesis prompt will embed (estimated from perLeg). */
  estimatedPromptTokens: number;
  /** Conservative upper bound on tokens the synthesis model may emit. */
  estimatedCompletionTokens: number;
}

export interface CouncilBudgetEstimate {
  /** Always true — this is a pre-call estimate. Billing uses real usage rows. */
  approximate: true;
  perLeg: PerLegEstimate[];
  synthesis: SynthesisEstimate | null;
  totalEstimatedTokens: number;
}

const DEFAULT_LEG_COMPLETION_TOKENS = 4096;
const DEFAULT_SYNTHESIS_COMPLETION_TOKENS = 4096;

/**
 * Rough conversion: 1 token ≈ 4 characters ≈ 0.75 words. We use character
 * length here so the estimator is deterministic and doesn't need a tokenizer.
 * This is intentionally an upper bound; actual billing reflects real usage.
 */
function estimateTokensFromChars(chars: number): number {
  return Math.ceil(chars / 4);
}

function lookupMaxOutput(endpoint: string, model: string): number {
  const max = getModelMaxOutputTokens(model, endpoint);
  if (typeof max === 'number' && max > 0) {
    return max;
  }
  return DEFAULT_LEG_COMPLETION_TOKENS;
}

export interface EstimateCouncilBudgetInput {
  primary: { endpoint: string; model: string };
  extras: CouncilAgentSpec[];
  strategy: SynthesisStrategy;
  /**
   * Approximate character length of the user question. Used to estimate
   * prompt tokens for each leg. Optional; defaults to 1200 chars ≈ 300
   * tokens if not provided (small but non-trivial request).
   */
  userQuestionChars?: number;
}

/**
 * Produces a conservative pre-call token estimate for a council request.
 * Server-authoritative: client sends a structured description of the
 * council composition, server responds with numbers. Client renders the
 * banner but never auto-blocks on this estimate (§D7).
 *
 * Total = per-leg completion upper bounds (N legs each at their model's
 *         maxOutputTokens) + synthesis completion upper bound + synthesis
 *         prompt tokens (derived from leg outputs).
 *
 * We deliberately do not include prompt tokens for legs in the total, since
 * leg prompts are dominated by the shared user question and the estimator
 * has access only to a rough character count. The banner is honest-shape:
 * "≈ N tokens estimated" with a clearly-approximate affordance.
 */
export function estimateCouncilBudget(
  input: EstimateCouncilBudgetInput,
): CouncilBudgetEstimate {
  const { primary, extras } = input;
  const allLegs = [primary, ...extras];

  const perLeg: PerLegEstimate[] = allLegs.map((leg) => ({
    endpoint: leg.endpoint,
    model: leg.model,
    estimatedCompletionTokens: lookupMaxOutput(leg.endpoint, leg.model),
  }));

  const noExtras = extras.length === 0;
  if (noExtras) {
    const total = perLeg.reduce((s, l) => s + l.estimatedCompletionTokens, 0);
    return {
      approximate: true,
      perLeg,
      synthesis: null,
      totalEstimatedTokens: total,
    };
  }

  const legOutputChars = perLeg.reduce(
    (s, l) => s + l.estimatedCompletionTokens * 4,
    0,
  );
  const synthesisPromptTokens = estimateTokensFromChars(
    legOutputChars + (input.userQuestionChars ?? 1200) + 1024,
  );
  const synthesisCompletionTokens = lookupMaxOutput(
    primary.endpoint,
    primary.model,
  );

  const synthesis: SynthesisEstimate = {
    endpoint: primary.endpoint,
    model: primary.model,
    estimatedPromptTokens: synthesisPromptTokens,
    estimatedCompletionTokens:
      synthesisCompletionTokens > 0
        ? synthesisCompletionTokens
        : DEFAULT_SYNTHESIS_COMPLETION_TOKENS,
  };

  const total =
    perLeg.reduce((s, l) => s + l.estimatedCompletionTokens, 0) +
    synthesis.estimatedPromptTokens +
    synthesis.estimatedCompletionTokens;

  return {
    approximate: true,
    perLeg,
    synthesis,
    totalEstimatedTokens: total,
  };
}
