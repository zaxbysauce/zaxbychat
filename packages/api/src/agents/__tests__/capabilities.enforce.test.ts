import {
  CapabilityRejection,
  enforceAgentCapabilities,
  emitCapabilityNotice,
  resolveAgentCapabilities,
} from '../capabilities';
import type { CapabilityNotice, EnforceableAgent } from '../capabilities';
import type { ModelCapabilities, CapabilityResolution } from 'librechat-data-provider';

const FULL: ModelCapabilities = {
  chat: true,
  vision: true,
  files: true,
  toolCalling: true,
  structuredOutput: true,
  streaming: true,
  embeddings: false,
  rerank: false,
  reasoning: false,
};

const NONE: ModelCapabilities = {
  chat: true,
  vision: false,
  files: false,
  toolCalling: false,
  structuredOutput: false,
  streaming: false,
  embeddings: false,
  rerank: false,
  reasoning: false,
};

function agent(overrides: Partial<EnforceableAgent> = {}): EnforceableAgent {
  return {
    provider: 'openAI',
    model: 'gpt-4o',
    tools: [],
    model_parameters: {},
    attachments: [],
    ...overrides,
  };
}

function imageFile() {
  return { type: 'image/png', height: 10, width: 10 } as unknown as import('@librechat/data-schemas').IMongoFile;
}

function pdfFile() {
  return { type: 'application/pdf' } as unknown as import('@librechat/data-schemas').IMongoFile;
}

const explicit = (caps: ModelCapabilities): CapabilityResolution => ({
  source: 'explicit',
  capabilities: caps,
});

const inferred = (
  caps: ModelCapabilities,
  matchedPattern = 'gpt-4o',
): CapabilityResolution => ({ source: 'inferred', capabilities: caps, matchedPattern });

const unknown: CapabilityResolution = { source: 'unknown' };

describe('enforceAgentCapabilities — vision', () => {
  it('explicit false + image attachment → rejects with VISION_NOT_SUPPORTED', () => {
    const a = agent({ attachments: [imageFile()] });
    expect(() =>
      enforceAgentCapabilities({ agent: a, resolution: explicit(NONE), strictMode: false }),
    ).toThrow(CapabilityRejection);
  });

  it('explicit true + image attachment → permits silently', () => {
    const a = agent({ attachments: [imageFile()] });
    const r = enforceAgentCapabilities({ agent: a, resolution: explicit(FULL), strictMode: false });
    expect(r.notices).toHaveLength(0);
  });

  it('inferred false + image attachment → warn + permit (non-strict)', () => {
    const a = agent({ attachments: [imageFile()] });
    const r = enforceAgentCapabilities({
      agent: a,
      resolution: inferred(NONE, 'some-pattern'),
      strictMode: false,
    });
    expect(r.notices).toHaveLength(1);
    expect(r.notices[0].capability).toBe('vision');
    expect(r.notices[0].severity).toBe('warning');
    expect(r.notices[0].action).toBe('soft_blocked');
    expect(r.notices[0].pattern).toBe('some-pattern');
  });

  it('inferred false + image attachment + strict mode → STILL warn (not rejected)', () => {
    const a = agent({ attachments: [imageFile()] });
    const r = enforceAgentCapabilities({
      agent: a,
      resolution: inferred(NONE),
      strictMode: true,
    });
    expect(r.notices).toHaveLength(1);
    expect(r.notices[0].severity).toBe('warning');
  });

  it('unknown + image attachment → info notice (non-strict)', () => {
    const a = agent({ attachments: [imageFile()] });
    const r = enforceAgentCapabilities({ agent: a, resolution: unknown, strictMode: false });
    expect(r.notices).toHaveLength(1);
    expect(r.notices[0].capability).toBe('vision');
    expect(r.notices[0].severity).toBe('info');
    expect(r.notices[0].action).toBe('unverified_capability');
    expect(r.notices[0].source).toBe('unknown');
  });

  it('unknown + image attachment + strict mode → rejects', () => {
    const a = agent({ attachments: [imageFile()] });
    expect(() =>
      enforceAgentCapabilities({ agent: a, resolution: unknown, strictMode: true }),
    ).toThrow(CapabilityRejection);
  });

  it('no image attachment → no vision notice regardless of source', () => {
    const a = agent({ attachments: [] });
    const r1 = enforceAgentCapabilities({ agent: a, resolution: explicit(NONE), strictMode: true });
    expect(r1.notices.filter((n) => n.capability === 'vision')).toHaveLength(0);

    const r2 = enforceAgentCapabilities({ agent: a, resolution: unknown, strictMode: true });
    expect(r2.notices.filter((n) => n.capability === 'vision')).toHaveLength(0);
  });
});

describe('enforceAgentCapabilities — files (non-image)', () => {
  it('explicit false + non-image attachment → rejects with FILES_NOT_SUPPORTED', () => {
    const a = agent({ attachments: [pdfFile()] });
    expect(() =>
      enforceAgentCapabilities({ agent: a, resolution: explicit(NONE), strictMode: false }),
    ).toThrow(CapabilityRejection);
  });

  it('inferred false + non-image attachment → warn + permit', () => {
    const a = agent({ attachments: [pdfFile()] });
    const r = enforceAgentCapabilities({
      agent: a,
      resolution: inferred(NONE),
      strictMode: false,
    });
    const notice = r.notices.find((n) => n.capability === 'files');
    expect(notice?.severity).toBe('warning');
    expect(notice?.action).toBe('soft_blocked');
  });

  it('unknown + non-image attachment + strict mode → rejects', () => {
    const a = agent({ attachments: [pdfFile()] });
    expect(() =>
      enforceAgentCapabilities({ agent: a, resolution: unknown, strictMode: true }),
    ).toThrow(CapabilityRejection);
  });

  it('image-only attachment → no files notice (handled by vision)', () => {
    const a = agent({ attachments: [imageFile()] });
    const r = enforceAgentCapabilities({ agent: a, resolution: explicit(FULL), strictMode: false });
    expect(r.notices.filter((n) => n.capability === 'files')).toHaveLength(0);
  });
});

describe('enforceAgentCapabilities — tool calling', () => {
  it('explicit false + tools present → drops tools with warn notice', () => {
    const a = agent({ tools: [{ name: 't1' }, { name: 't2' }] });
    const r = enforceAgentCapabilities({ agent: a, resolution: explicit(NONE), strictMode: false });
    expect(a.tools).toEqual([]);
    const notice = r.notices.find((n) => n.capability === 'toolCalling');
    expect(notice?.action).toBe('dropped_tools');
    expect(notice?.source).toBe('explicit');
  });

  it('inferred false + tools present → drops tools with warn notice', () => {
    const a = agent({
      tools: [{ name: 't1' }],
      model: 'o1-mini',
    });
    const r = enforceAgentCapabilities({
      agent: a,
      resolution: inferred(NONE, 'o1-mini'),
      strictMode: false,
    });
    expect(a.tools).toEqual([]);
    const notice = r.notices.find((n) => n.capability === 'toolCalling');
    expect(notice?.action).toBe('dropped_tools');
    expect(notice?.source).toBe('inferred');
    expect(notice?.pattern).toBe('o1-mini');
  });

  it('unknown + tools present → no tool notice (tools kept)', () => {
    const a = agent({ tools: [{ name: 't1' }] });
    const r = enforceAgentCapabilities({ agent: a, resolution: unknown, strictMode: false });
    expect(a.tools).toEqual([{ name: 't1' }]);
    expect(r.notices.filter((n) => n.capability === 'toolCalling')).toHaveLength(0);
  });

  it('no tools → no tool notice regardless of source', () => {
    const a = agent({ tools: [] });
    const r = enforceAgentCapabilities({ agent: a, resolution: explicit(NONE), strictMode: false });
    expect(r.notices.filter((n) => n.capability === 'toolCalling')).toHaveLength(0);
  });
});

describe('enforceAgentCapabilities — structured output', () => {
  it('explicit false + response_format present → strips + warns', () => {
    const a = agent({
      model_parameters: { response_format: { type: 'json_object' }, temperature: 0.5 },
    });
    const r = enforceAgentCapabilities({ agent: a, resolution: explicit(NONE), strictMode: false });
    expect(a.model_parameters?.response_format).toBeUndefined();
    expect(a.model_parameters?.temperature).toBe(0.5);
    const notice = r.notices.find((n) => n.capability === 'structuredOutput');
    expect(notice?.action).toBe('stripped_structured_output');
  });

  it('response_format === "text" → treated as not present', () => {
    const a = agent({ model_parameters: { response_format: 'text' } });
    const r = enforceAgentCapabilities({ agent: a, resolution: explicit(NONE), strictMode: false });
    expect(r.notices.filter((n) => n.capability === 'structuredOutput')).toHaveLength(0);
  });

  it('inferred false + response_format present → strips + warns', () => {
    const a = agent({ model_parameters: { response_format: { type: 'json_object' } } });
    const r = enforceAgentCapabilities({
      agent: a,
      resolution: inferred(NONE),
      strictMode: false,
    });
    expect(a.model_parameters?.response_format).toBeUndefined();
    const notice = r.notices.find((n) => n.capability === 'structuredOutput');
    expect(notice?.source).toBe('inferred');
  });

  it('no response_format → no structured notice', () => {
    const a = agent({ model_parameters: { temperature: 0.5 } });
    const r = enforceAgentCapabilities({ agent: a, resolution: explicit(NONE), strictMode: false });
    expect(r.notices.filter((n) => n.capability === 'structuredOutput')).toHaveLength(0);
  });
});

describe('enforceAgentCapabilities — trust hierarchy', () => {
  it('explicit false is authoritative regardless of strict mode', () => {
    const a = agent({ attachments: [imageFile()] });
    expect(() =>
      enforceAgentCapabilities({ agent: a, resolution: explicit(NONE), strictMode: false }),
    ).toThrow(CapabilityRejection);
    expect(() =>
      enforceAgentCapabilities({ agent: a, resolution: explicit(NONE), strictMode: true }),
    ).toThrow(CapabilityRejection);
  });

  it('inferred false is NEVER auto-upgraded to hard reject by strict mode', () => {
    const a1 = agent({ attachments: [imageFile()] });
    expect(() =>
      enforceAgentCapabilities({ agent: a1, resolution: inferred(NONE), strictMode: true }),
    ).not.toThrow();

    const a2 = agent({ attachments: [pdfFile()] });
    expect(() =>
      enforceAgentCapabilities({ agent: a2, resolution: inferred(NONE), strictMode: true }),
    ).not.toThrow();
  });
});

describe('resolveAgentCapabilities', () => {
  it('delegates to data-provider resolver with appConfig specs', () => {
    const result = resolveAgentCapabilities('openAI', 'gpt-4o');
    expect(result.source).toBe('inferred');
    if (result.source === 'inferred') {
      expect(result.matchedPattern).toBe('gpt-4o');
    }
  });

  it('returns unknown when no specs and model not in inference table', () => {
    const result = resolveAgentCapabilities('custom', 'novel-xyz');
    expect(result).toEqual({ source: 'unknown' });
  });
});

describe('emitCapabilityNotice', () => {
  function mockRes() {
    const writes: string[] = [];
    return {
      res: {
        writableEnded: false,
        write: (chunk: string) => {
          writes.push(chunk);
          return true;
        },
      } as unknown as import('express').Response,
      writes,
    };
  }

  const notice: CapabilityNotice = {
    capability: 'toolCalling',
    severity: 'warning',
    source: 'explicit',
    action: 'dropped_tools',
    message: 'Tools dropped.',
  };

  it('writes a properly framed SSE event with event: capability_notice', () => {
    const { res, writes } = mockRes();
    emitCapabilityNotice(res, notice);
    expect(writes).toHaveLength(1);
    expect(writes[0].startsWith('event: capability_notice\n')).toBe(true);
    expect(writes[0].endsWith('\n\n')).toBe(true);
    const dataLine = writes[0].split('\n').find((l) => l.startsWith('data: '));
    expect(dataLine).toBeDefined();
    expect(JSON.parse(dataLine!.replace('data: ', ''))).toEqual(notice);
  });

  it('skips write when response has already ended', () => {
    const { writes } = mockRes();
    const res = {
      writableEnded: true,
      write: () => {
        throw new Error('should not be called');
      },
    } as unknown as import('express').Response;
    expect(() => emitCapabilityNotice(res, notice)).not.toThrow();
    expect(writes).toHaveLength(0);
  });
});
