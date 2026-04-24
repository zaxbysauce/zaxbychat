import { createAbortHierarchy } from '../abort';

describe('createAbortHierarchy — invariants', () => {
  it('creates N leg controllers and one synthesis controller', () => {
    const parent = new AbortController();
    const h = createAbortHierarchy(parent, 3);
    expect(h.legs).toHaveLength(3);
    expect(h.parent).toBe(parent);
    expect(h.synthesis).toBeDefined();
    for (const leg of h.legs) {
      expect(leg.signal.aborted).toBe(false);
    }
    expect(h.synthesis.signal.aborted).toBe(false);
    expect(h.parent.signal.aborted).toBe(false);
  });

  it('throws when legCount < 1', () => {
    const parent = new AbortController();
    expect(() => createAbortHierarchy(parent, 0)).toThrow();
    expect(() => createAbortHierarchy(parent, -1)).toThrow();
  });
});

describe('createAbortHierarchy — stop-all cascades', () => {
  it('abortAll aborts parent, all legs, and synthesis', () => {
    const parent = new AbortController();
    const h = createAbortHierarchy(parent, 3);

    h.abortAll('user stopped');

    expect(h.parent.signal.aborted).toBe(true);
    for (const leg of h.legs) {
      expect(leg.signal.aborted).toBe(true);
    }
    expect(h.synthesis.signal.aborted).toBe(true);
  });

  it('aborting the parent directly cascades to legs and synthesis', () => {
    const parent = new AbortController();
    const h = createAbortHierarchy(parent, 2);

    parent.abort('external abort');

    for (const leg of h.legs) {
      expect(leg.signal.aborted).toBe(true);
    }
    expect(h.synthesis.signal.aborted).toBe(true);
  });

  it('abortAll is idempotent', () => {
    const parent = new AbortController();
    const h = createAbortHierarchy(parent, 2);

    h.abortAll();
    h.abortAll();

    expect(h.parent.signal.aborted).toBe(true);
    expect(h.legs[0].signal.aborted).toBe(true);
  });

  it('hierarchy constructed from an already-aborted parent aborts children immediately', () => {
    const parent = new AbortController();
    parent.abort('pre-aborted');
    const h = createAbortHierarchy(parent, 2);

    expect(h.legs[0].signal.aborted).toBe(true);
    expect(h.legs[1].signal.aborted).toBe(true);
    expect(h.synthesis.signal.aborted).toBe(true);
  });
});

describe('createAbortHierarchy — stop-one does not touch siblings', () => {
  it('abortLeg aborts the targeted leg only', () => {
    const parent = new AbortController();
    const h = createAbortHierarchy(parent, 3);

    h.abortLeg(1);

    expect(h.legs[0].signal.aborted).toBe(false);
    expect(h.legs[1].signal.aborted).toBe(true);
    expect(h.legs[2].signal.aborted).toBe(false);
    expect(h.synthesis.signal.aborted).toBe(false);
    expect(h.parent.signal.aborted).toBe(false);
  });

  it('abortLeg is idempotent for the same index', () => {
    const parent = new AbortController();
    const h = createAbortHierarchy(parent, 2);
    h.abortLeg(0);
    h.abortLeg(0);
    expect(h.legs[0].signal.aborted).toBe(true);
    expect(h.legs[1].signal.aborted).toBe(false);
  });

  it('abortLeg throws for out-of-range index', () => {
    const parent = new AbortController();
    const h = createAbortHierarchy(parent, 2);
    expect(() => h.abortLeg(2)).toThrow(RangeError);
    expect(() => h.abortLeg(-1)).toThrow(RangeError);
  });
});

describe('createAbortHierarchy — stop-synthesis leaves legs alone', () => {
  it('abortSynthesis aborts only the synthesis child', () => {
    const parent = new AbortController();
    const h = createAbortHierarchy(parent, 2);

    h.abortSynthesis();

    expect(h.synthesis.signal.aborted).toBe(true);
    expect(h.legs[0].signal.aborted).toBe(false);
    expect(h.legs[1].signal.aborted).toBe(false);
    expect(h.parent.signal.aborted).toBe(false);
  });
});

describe('createAbortHierarchy — abort reason propagation', () => {
  it('cascaded aborts preserve the parent abort reason', () => {
    const parent = new AbortController();
    const h = createAbortHierarchy(parent, 2);

    parent.abort('network loss');

    expect(h.legs[0].signal.reason).toBe('network loss');
    expect(h.synthesis.signal.reason).toBe('network loss');
  });

  it('per-leg abort reason does not leak to siblings', () => {
    const parent = new AbortController();
    const h = createAbortHierarchy(parent, 2);

    h.abortLeg(0, 'leg 0 model unavailable');

    expect(h.legs[0].signal.reason).toBe('leg 0 model unavailable');
    expect(h.legs[1].signal.aborted).toBe(false);
  });
});
