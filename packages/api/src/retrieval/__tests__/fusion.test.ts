/**
 * Phase 6 port test — fusion.ts.
 *
 * Verifies the TS port preserves the donor's RRF semantics
 * (fusion.py:9-86, SHA c3e6c5103fa9cd55c194a8a241dd59e1a7b3e072):
 *
 *   - Formula `weight * 1 / (k + rank + 1)` at canonical k=60.
 *   - Deduplication by `id` across lists.
 *   - Recency blending with 0.5 neutral for missing ids.
 *   - Per-list weights throw when shorter than result-lists length.
 *   - Missing `id` fallback keys `list_{i}_rank_{rank}`.
 */
import { rrfFuse } from '../fusion';

describe('rrfFuse', () => {
  it('applies the donor RRF formula at k=60', () => {
    const fused = rrfFuse([
      [{ id: 'a' }, { id: 'b' }],
    ]);
    expect(fused).toHaveLength(2);
    expect(fused[0].id).toBe('a');
    expect(fused[0]._rrfScore).toBeCloseTo(1 / 61, 10);
    expect(fused[1].id).toBe('b');
    expect(fused[1]._rrfScore).toBeCloseTo(1 / 62, 10);
  });

  it('sums scores across lists for the same id', () => {
    const fused = rrfFuse([
      [{ id: 'a' }, { id: 'b' }],
      [{ id: 'b' }, { id: 'a' }],
    ]);
    const a = fused.find((r) => r.id === 'a');
    const b = fused.find((r) => r.id === 'b');
    expect(a?._rrfScore).toBeCloseTo(1 / 61 + 1 / 62, 10);
    expect(b?._rrfScore).toBeCloseTo(1 / 62 + 1 / 61, 10);
  });

  it('applies recency blending with 0.5 neutral default for missing ids', () => {
    const fused = rrfFuse(
      [[{ id: 'a' }, { id: 'b' }]],
      { recencyScores: { a: 1.0 }, recencyWeight: 0.5 },
    );
    const a = fused.find((r) => r.id === 'a');
    const b = fused.find((r) => r.id === 'b');
    const expectedA = (1 / 61) * 0.5 + 1.0 * 0.5;
    const expectedB = (1 / 62) * 0.5 + 0.5 * 0.5;
    expect(a?._rrfScore).toBeCloseTo(expectedA, 10);
    expect(b?._rrfScore).toBeCloseTo(expectedB, 10);
  });

  it('honors per-list weights', () => {
    const fused = rrfFuse(
      [[{ id: 'a' }], [{ id: 'a' }]],
      { weights: [2.0, 0.5] },
    );
    const a = fused.find((r) => r.id === 'a');
    expect(a?._rrfScore).toBeCloseTo(2.0 * (1 / 61) + 0.5 * (1 / 61), 10);
  });

  it('throws when weights are shorter than result-lists', () => {
    expect(() =>
      rrfFuse([[{ id: 'a' }], [{ id: 'b' }]], { weights: [1.0] }),
    ).toThrow(/weights list/);
  });

  it('synthesizes a fallback uid when id is missing', () => {
    const fused = rrfFuse([[{ label: 'x' } as { id?: string; label: string }]]);
    expect(fused).toHaveLength(1);
    expect(fused[0].label).toBe('x');
  });

  it('respects limit', () => {
    const fused = rrfFuse(
      [[{ id: 'a' }, { id: 'b' }, { id: 'c' }]],
      { limit: 2 },
    );
    expect(fused.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('returns empty list for empty input', () => {
    expect(rrfFuse([])).toEqual([]);
  });

  it('sort is stable by score descending', () => {
    const fused = rrfFuse([
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      [{ id: 'c' }, { id: 'b' }, { id: 'a' }],
    ]);
    const scores = fused.map((r) => r._rrfScore);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]);
    }
  });
});
