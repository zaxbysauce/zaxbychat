import { SYNTHESIS_AGENT_ID } from 'librechat-data-provider';
import type { GraphEdge } from 'librechat-data-provider';

/**
 * Builds the council-mode synthesis edge: many-to-one fan-in from every
 * council leg to the synthesis node. Uses the existing `edges: GraphEdge[]`
 * surface from @librechat/agents; no new graph-package contract.
 *
 * V4b verified that `edges.from` accepts a string[] fan-in and the SDK
 * normalizes the shape internally. No fork needed.
 *
 * @param legAgentIds — one entry per council leg agent (primary + extras),
 *   in execution order. Duplicates are filtered defensively.
 * @throws if legAgentIds is empty (a council edge with no sources is
 *   malformed; callers must use non-council graph when no legs are present).
 */
export function buildSynthesisEdge(legAgentIds: string[]): GraphEdge {
  if (!legAgentIds || legAgentIds.length === 0) {
    throw new Error('buildSynthesisEdge: legAgentIds must contain at least one agent id');
  }
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const id of legAgentIds) {
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    unique.push(id);
  }
  if (unique.length === 0) {
    throw new Error('buildSynthesisEdge: no valid agent ids after deduplication');
  }
  return {
    from: unique.length === 1 ? unique[0] : unique,
    to: SYNTHESIS_AGENT_ID,
  };
}

/**
 * Returns true if `agentId` identifies the synthesis node. Useful for
 * per-handler routing that needs to differentiate synthesis deltas from
 * leg deltas on the same SSE channel.
 */
export function isSynthesisAgentId(agentId: string | undefined | null): boolean {
  return agentId === SYNTHESIS_AGENT_ID;
}
