/**
 * Parent/child AbortController hierarchy for council-mode runs (Phase 4 §D3).
 *
 * The parent is the existing job-level AbortController (unchanged from non-council
 * behavior). Each council leg gets its own child; the synthesis node gets one
 * more child. Children wire themselves to abort whenever the parent aborts so
 * `stop-all` cascades; `stop-one` aborts a single child without disturbing
 * siblings.
 *
 * Non-council runs never construct this hierarchy — they keep the single shared
 * controller they have today.
 */

export interface AbortHierarchy {
  /** The existing job-level AbortController. All children inherit its abort. */
  readonly parent: AbortController;
  /** Per-leg controllers keyed by leg index (0-based; 0 = primary). */
  readonly legs: ReadonlyArray<AbortController>;
  /** Single synthesis-node controller. */
  readonly synthesis: AbortController;
  /** Aborts the parent (and therefore every child via cascade). */
  abortAll(reason?: unknown): void;
  /** Aborts a single leg by index without affecting siblings or synthesis. */
  abortLeg(index: number, reason?: unknown): void;
  /** Aborts only the synthesis child without affecting legs. */
  abortSynthesis(reason?: unknown): void;
}

/**
 * Creates a council-mode abort hierarchy rooted at `parent`. `legCount` must
 * be the total number of council legs including the primary (e.g. 3 for a
 * primary + 2 extras configuration).
 */
export function createAbortHierarchy(parent: AbortController, legCount: number): AbortHierarchy {
  if (legCount < 1) {
    throw new Error(`createAbortHierarchy: legCount must be >= 1, got ${legCount}`);
  }

  const legs: AbortController[] = [];
  for (let i = 0; i < legCount; i++) {
    legs.push(new AbortController());
  }
  const synthesis = new AbortController();

  const cascadeFromParent = () => {
    const reason = parent.signal.reason;
    for (const leg of legs) {
      if (!leg.signal.aborted) {
        leg.abort(reason);
      }
    }
    if (!synthesis.signal.aborted) {
      synthesis.abort(reason);
    }
  };

  if (parent.signal.aborted) {
    cascadeFromParent();
  } else {
    parent.signal.addEventListener('abort', cascadeFromParent, { once: true });
  }

  return {
    parent,
    legs,
    synthesis,
    abortAll(reason?: unknown) {
      if (parent.signal.aborted) {
        return;
      }
      parent.abort(reason);
    },
    abortLeg(index: number, reason?: unknown) {
      if (index < 0 || index >= legs.length) {
        throw new RangeError(`abortLeg: index ${index} out of range [0, ${legs.length - 1}]`);
      }
      const leg = legs[index];
      if (!leg.signal.aborted) {
        leg.abort(reason);
      }
    },
    abortSynthesis(reason?: unknown) {
      if (!synthesis.signal.aborted) {
        synthesis.abort(reason);
      }
    },
  };
}
