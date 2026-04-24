import {
  councilAgentSpecSchema,
  councilAgentsSchema,
  synthesisStrategySchema,
  validateCouncilComposition,
  councilLegFingerprint,
  MAX_COUNCIL_EXTRAS,
  DEFAULT_SYNTHESIS_STRATEGY,
  SYNTHESIS_AGENT_ID,
} from '../council';

describe('councilAgentSpecSchema', () => {
  it('accepts minimal valid entry', () => {
    const r = councilAgentSpecSchema.safeParse({ endpoint: 'openAI', model: 'gpt-4o' });
    expect(r.success).toBe(true);
  });

  it('accepts entry with agent_id', () => {
    const r = councilAgentSpecSchema.safeParse({
      endpoint: 'anthropic',
      model: 'claude-opus-4-7',
      agent_id: 'agent_abc',
    });
    expect(r.success).toBe(true);
  });

  it('rejects empty endpoint', () => {
    expect(councilAgentSpecSchema.safeParse({ endpoint: '', model: 'gpt-4o' }).success).toBe(false);
  });

  it('rejects empty model', () => {
    expect(councilAgentSpecSchema.safeParse({ endpoint: 'openAI', model: '' }).success).toBe(false);
  });

  it('rejects missing endpoint', () => {
    expect(councilAgentSpecSchema.safeParse({ model: 'gpt-4o' } as unknown).success).toBe(false);
  });

  it('rejects non-string agent_id', () => {
    const r = councilAgentSpecSchema.safeParse({
      endpoint: 'openAI',
      model: 'gpt-4o',
      agent_id: 5 as unknown as string,
    });
    expect(r.success).toBe(false);
  });
});

describe('councilAgentsSchema — extras-only, bounded at 2', () => {
  it('accepts empty array (no extras — equivalent to single-agent mode)', () => {
    expect(councilAgentsSchema.safeParse([]).success).toBe(true);
  });

  it('accepts one extra', () => {
    expect(
      councilAgentsSchema.safeParse([{ endpoint: 'openAI', model: 'gpt-4o' }]).success,
    ).toBe(true);
  });

  it(`accepts ${MAX_COUNCIL_EXTRAS} extras`, () => {
    const extras = [
      { endpoint: 'openAI', model: 'gpt-4o' },
      { endpoint: 'anthropic', model: 'claude-opus-4-7' },
    ];
    expect(councilAgentsSchema.safeParse(extras).success).toBe(true);
  });

  it(`rejects ${MAX_COUNCIL_EXTRAS + 1} extras`, () => {
    const tooMany = [
      { endpoint: 'openAI', model: 'gpt-4o' },
      { endpoint: 'anthropic', model: 'claude-opus-4-7' },
      { endpoint: 'google', model: 'gemini-2.5-pro' },
    ];
    expect(councilAgentsSchema.safeParse(tooMany).success).toBe(false);
  });
});

describe('councilLegFingerprint', () => {
  it('identical triples produce the same fingerprint', () => {
    const a = councilLegFingerprint({ endpoint: 'openAI', model: 'gpt-4o' });
    const b = councilLegFingerprint({ endpoint: 'openAI', model: 'gpt-4o', agent_id: undefined });
    expect(a).toBe(b);
  });

  it('differs when agent_id differs', () => {
    const a = councilLegFingerprint({ endpoint: 'openAI', model: 'gpt-4o' });
    const b = councilLegFingerprint({ endpoint: 'openAI', model: 'gpt-4o', agent_id: 'agent_x' });
    expect(a).not.toBe(b);
  });

  it('treats null and undefined agent_id identically', () => {
    const a = councilLegFingerprint({ endpoint: 'openAI', model: 'gpt-4o', agent_id: null });
    const b = councilLegFingerprint({ endpoint: 'openAI', model: 'gpt-4o' });
    expect(a).toBe(b);
  });
});

describe('validateCouncilComposition', () => {
  const primary = { endpoint: 'openAI', model: 'gpt-4o' };

  it('returns null for valid extras-only composition with unique legs', () => {
    expect(
      validateCouncilComposition({
        primary,
        extras: [
          { endpoint: 'anthropic', model: 'claude-opus-4-7' },
          { endpoint: 'google', model: 'gemini-2.5-pro' },
        ],
      }),
    ).toBeNull();
  });

  it('returns null for empty extras', () => {
    expect(validateCouncilComposition({ primary, extras: [] })).toBeNull();
  });

  it('detects duplicate between primary and extra', () => {
    const r = validateCouncilComposition({
      primary,
      extras: [{ endpoint: 'openAI', model: 'gpt-4o' }],
    });
    expect(r).not.toBeNull();
    expect(r?.reason).toBe('duplicate_leg');
  });

  it('detects duplicate between two extras', () => {
    const r = validateCouncilComposition({
      primary,
      extras: [
        { endpoint: 'anthropic', model: 'claude-opus-4-7' },
        { endpoint: 'anthropic', model: 'claude-opus-4-7' },
      ],
    });
    expect(r?.reason).toBe('duplicate_leg');
  });

  it('distinguishes legs with different agent_id even when endpoint/model match', () => {
    expect(
      validateCouncilComposition({
        primary: { endpoint: 'openAI', model: 'gpt-4o', agent_id: 'a1' },
        extras: [{ endpoint: 'openAI', model: 'gpt-4o', agent_id: 'a2' }],
      }),
    ).toBeNull();
  });

  it('detects too many extras', () => {
    const r = validateCouncilComposition({
      primary,
      extras: [
        { endpoint: 'a', model: 'm1' },
        { endpoint: 'b', model: 'm2' },
        { endpoint: 'c', model: 'm3' },
      ],
    });
    expect(r?.reason).toBe('too_many_extras');
  });
});

describe('synthesisStrategySchema', () => {
  it.each(['primary_critic', 'best_of_three', 'compare_and_synthesize'])(
    'accepts %s',
    (strategy) => {
      expect(synthesisStrategySchema.safeParse(strategy).success).toBe(true);
    },
  );

  it('rejects unknown strategy', () => {
    expect(synthesisStrategySchema.safeParse('majority_vote').success).toBe(false);
  });

  it('has compare_and_synthesize as the default per design §D6', () => {
    expect(DEFAULT_SYNTHESIS_STRATEGY).toBe('compare_and_synthesize');
  });
});

describe('SYNTHESIS_AGENT_ID', () => {
  it('uses underscore-wrapped reserved form to avoid collision with real agent ids', () => {
    expect(SYNTHESIS_AGENT_ID).toBe('__synthesis__');
    expect(SYNTHESIS_AGENT_ID).not.toMatch(/____\d+$/);
  });
});
