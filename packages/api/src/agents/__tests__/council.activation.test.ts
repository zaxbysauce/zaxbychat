import { evaluateCouncilActivation, resolveCouncilExtras } from '../council';
import type { AppConfig } from '@librechat/data-schemas';

function appConfigWith(councilFlag: boolean | undefined): AppConfig | undefined {
  if (councilFlag === undefined) {
    return undefined;
  }
  return {
    interfaceConfig: { council: councilFlag },
  } as unknown as AppConfig;
}

const primary = { endpoint: 'openAI', model: 'gpt-4o' };

describe('evaluateCouncilActivation — gating', () => {
  it('returns flag_off when interfaceConfig.council is undefined', () => {
    const r = evaluateCouncilActivation({
      appConfig: appConfigWith(undefined),
      councilAgents: [{ endpoint: 'anthropic', model: 'claude-opus-4-7' }],
      primary,
    });
    expect(r.status).toBe('flag_off');
  });

  it('returns flag_off when flag explicitly false', () => {
    const r = evaluateCouncilActivation({
      appConfig: appConfigWith(false),
      councilAgents: [{ endpoint: 'anthropic', model: 'claude-opus-4-7' }],
      primary,
    });
    expect(r.status).toBe('flag_off');
  });

  it('returns no_extras when flag on but extras empty', () => {
    const r = evaluateCouncilActivation({
      appConfig: appConfigWith(true),
      councilAgents: [],
      primary,
    });
    expect(r.status).toBe('no_extras');
  });

  it('returns no_extras when flag on but extras undefined', () => {
    const r = evaluateCouncilActivation({
      appConfig: appConfigWith(true),
      councilAgents: undefined,
      primary,
    });
    expect(r.status).toBe('invalid_extras');
  });

  it('returns active for valid one-extra configuration', () => {
    const r = evaluateCouncilActivation({
      appConfig: appConfigWith(true),
      councilAgents: [{ endpoint: 'anthropic', model: 'claude-opus-4-7' }],
      primary,
    });
    expect(r.status).toBe('active');
  });

  it('returns active for valid two-extra configuration', () => {
    const r = evaluateCouncilActivation({
      appConfig: appConfigWith(true),
      councilAgents: [
        { endpoint: 'anthropic', model: 'claude-opus-4-7' },
        { endpoint: 'google', model: 'gemini-2.5-pro' },
      ],
      primary,
    });
    expect(r.status).toBe('active');
  });
});

describe('evaluateCouncilActivation — validation rejections', () => {
  it('rejects non-array extras as invalid', () => {
    const r = evaluateCouncilActivation({
      appConfig: appConfigWith(true),
      councilAgents: 'not-an-array',
      primary,
    });
    expect(r.status).toBe('invalid_extras');
  });

  it('rejects extras with missing endpoint', () => {
    const r = evaluateCouncilActivation({
      appConfig: appConfigWith(true),
      councilAgents: [{ model: 'gpt-4o' }],
      primary,
    });
    expect(r.status).toBe('invalid_extras');
  });

  it('rejects duplicate of primary in extras', () => {
    const r = evaluateCouncilActivation({
      appConfig: appConfigWith(true),
      councilAgents: [{ endpoint: 'openAI', model: 'gpt-4o' }],
      primary,
    });
    expect(r.status).toBe('duplicate_leg');
    if (r.status === 'duplicate_leg') {
      expect(r.info).toContain('duplicates');
    }
  });

  it('rejects duplicate between two extras', () => {
    const r = evaluateCouncilActivation({
      appConfig: appConfigWith(true),
      councilAgents: [
        { endpoint: 'anthropic', model: 'claude-opus-4-7' },
        { endpoint: 'anthropic', model: 'claude-opus-4-7' },
      ],
      primary,
    });
    expect(r.status).toBe('duplicate_leg');
  });

  it('rejects more than 2 extras at schema layer first', () => {
    const r = evaluateCouncilActivation({
      appConfig: appConfigWith(true),
      councilAgents: [
        { endpoint: 'a', model: 'm1' },
        { endpoint: 'b', model: 'm2' },
        { endpoint: 'c', model: 'm3' },
      ],
      primary,
    });
    expect(r.status).toBe('invalid_extras');
  });
});

describe('resolveCouncilExtras', () => {
  it('returns the extras array when activation is active', () => {
    const extras = resolveCouncilExtras({
      appConfig: appConfigWith(true),
      councilAgents: [{ endpoint: 'anthropic', model: 'claude-opus-4-7' }],
      primary,
    });
    expect(extras).toHaveLength(1);
    expect(extras?.[0].endpoint).toBe('anthropic');
  });

  it('returns null when flag is off', () => {
    expect(
      resolveCouncilExtras({
        appConfig: appConfigWith(false),
        councilAgents: [{ endpoint: 'anthropic', model: 'claude-opus-4-7' }],
        primary,
      }),
    ).toBeNull();
  });

  it('returns null when duplicate detected', () => {
    expect(
      resolveCouncilExtras({
        appConfig: appConfigWith(true),
        councilAgents: [{ endpoint: 'openAI', model: 'gpt-4o' }],
        primary,
      }),
    ).toBeNull();
  });

  it('returns null for no-extras case', () => {
    expect(
      resolveCouncilExtras({
        appConfig: appConfigWith(true),
        councilAgents: [],
        primary,
      }),
    ).toBeNull();
  });
});

describe('evaluateCouncilActivation — appConfig absent', () => {
  it('treats missing appConfig as flag_off', () => {
    const r = evaluateCouncilActivation({
      appConfig: undefined,
      councilAgents: [{ endpoint: 'anthropic', model: 'claude-opus-4-7' }],
      primary,
    });
    expect(r.status).toBe('flag_off');
  });
});
