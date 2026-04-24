/**
 * Phase 6 — Reciprocal Rank Fusion (RRF).
 *
 * Port of ragappv3 `backend/app/utils/fusion.py` (donor SHA
 * c3e6c5103fa9cd55c194a8a241dd59e1a7b3e072, lines 1-86). Pure data
 * manipulation; zero external dependencies transplanted.
 *
 * Formula preserved verbatim: `weight * 1 / (k + rank + 1)`. Recency
 * blending: `rrf * (1 - recency_weight) + rec * recency_weight`, with
 * 0.5 as the neutral score for records missing from `recencyScores`.
 */

export type RrfInput = {
  id?: string;
  [key: string]: unknown;
};

export type RrfFused<T extends RrfInput> = T & { _rrfScore: number };

export type RrfOptions = {
  k?: number;
  limit?: number;
  recencyScores?: Record<string, number>;
  recencyWeight?: number;
  weights?: number[];
};

/**
 * Fuse multiple ranked result lists via Reciprocal Rank Fusion.
 *
 * @param resultLists Ranked lists from independent queries/scales/sources.
 * @param options RRF constant, output limit, optional recency blend, per-list weights.
 * @returns Deduplicated results sorted by final score descending, each with `_rrfScore`.
 *
 * @throws Error when `weights.length` is smaller than `resultLists.length`
 *   (donor `fusion.py:47-50` — same guard).
 */
export function rrfFuse<T extends RrfInput>(
  resultLists: T[][],
  options: RrfOptions = {},
): RrfFused<T>[] {
  const { k = 60, limit, recencyScores, recencyWeight = 0.1, weights } = options;

  const rrfScores = new Map<string, number>();
  const idToRecord = new Map<string, T>();

  for (let i = 0; i < resultLists.length; i++) {
    if (weights && i >= weights.length) {
      throw new Error(
        `weights list has ${weights.length} items but ${resultLists.length} result lists were provided`,
      );
    }
    const weight = weights ? weights[i] : 1.0;
    const results = resultLists[i];
    for (let rank = 0; rank < results.length; rank++) {
      const record = results[rank];
      const uid = record.id ?? `list_${i}_rank_${rank}`;
      const score = (weight * 1.0) / (k + rank + 1);
      rrfScores.set(uid, (rrfScores.get(uid) ?? 0) + score);
      if (!idToRecord.has(uid)) {
        idToRecord.set(uid, record);
      }
    }
  }

  const shouldBlendRecency = recencyScores != null && recencyWeight > 0.0;
  const finalScores = shouldBlendRecency
    ? blendRecency(rrfScores, recencyScores, recencyWeight)
    : rrfScores;

  const sortedUids = Array.from(finalScores.keys()).sort(
    (a, b) => (finalScores.get(b) ?? 0) - (finalScores.get(a) ?? 0),
  );

  const take = limit != null ? sortedUids.slice(0, limit) : sortedUids;

  const fused: RrfFused<T>[] = [];
  for (const uid of take) {
    const source = idToRecord.get(uid);
    if (!source) continue;
    fused.push({ ...source, _rrfScore: finalScores.get(uid) ?? 0 });
  }
  return fused;
}

function blendRecency(
  rrfScores: Map<string, number>,
  recencyScores: Record<string, number>,
  recencyWeight: number,
): Map<string, number> {
  const blended = new Map<string, number>();
  for (const [uid, rrfScore] of rrfScores) {
    const recScore = Object.prototype.hasOwnProperty.call(recencyScores, uid)
      ? recencyScores[uid]
      : 0.5;
    blended.set(uid, rrfScore * (1.0 - recencyWeight) + recScore * recencyWeight);
  }
  return blended;
}
