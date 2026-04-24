import {
  inferCapabilities,
  resolveCapabilities,
  __getInferenceEntriesForTest,
} from '../capabilities';
import type { TModelSpec, ModelCapabilities } from '../models';

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

function spec(endpoint: string, model: string, capabilities?: ModelCapabilities): TModelSpec {
  return {
    name: `${endpoint}/${model}`,
    label: model,
    preset: { endpoint, model },
    capabilities,
  } as TModelSpec;
}

describe('inferCapabilities', () => {
  it('returns null for empty model name', () => {
    expect(inferCapabilities('')).toBeNull();
  });

  it('returns null for unmatched model name', () => {
    expect(inferCapabilities('totally-novel-future-model-xyz')).toBeNull();
  });

  it('matches gpt-4o → vision=true', () => {
    const r = inferCapabilities('gpt-4o');
    expect(r?.matchedPattern).toBe('gpt-4o');
    expect(r?.capabilities.vision).toBe(true);
  });

  it('matches gpt-4o-mini → vision=true via "gpt-4o" substring', () => {
    const r = inferCapabilities('gpt-4o-mini');
    expect(r?.matchedPattern).toBe('gpt-4o');
    expect(r?.capabilities.vision).toBe(true);
  });

  it('longest-match wins: gpt-5-pro beats gpt-5', () => {
    const r = inferCapabilities('gpt-5-pro');
    expect(r?.matchedPattern).toBe('gpt-5-pro');
    expect(r?.capabilities.reasoning).toBe(true);
  });

  it('longest-match wins: gpt-5 beats nothing longer for gpt-5-mini', () => {
    const r = inferCapabilities('gpt-5-mini');
    expect(r?.matchedPattern).toBe('gpt-5');
    expect(r?.capabilities.reasoning).toBe(false);
  });

  it('case-insensitive match', () => {
    const r = inferCapabilities('Claude-Opus-4-7');
    expect(r?.matchedPattern).toBe('claude-opus-4-7');
    expect(r?.capabilities.reasoning).toBe(true);
  });

  it('o1-mini → toolCalling=false, reasoning=true', () => {
    const r = inferCapabilities('o1-mini');
    expect(r?.capabilities.toolCalling).toBe(false);
    expect(r?.capabilities.reasoning).toBe(true);
  });

  it('o1 (not -mini) → toolCalling=true, vision=true, reasoning=true', () => {
    const r = inferCapabilities('o1');
    expect(r?.matchedPattern).toBe('o1');
    expect(r?.capabilities.toolCalling).toBe(true);
    expect(r?.capabilities.vision).toBe(true);
  });

  it('grok-3 → null (not in table; stays unknown by design, no opportunistic entry)', () => {
    expect(inferCapabilities('grok-3')).toBeNull();
  });

  it('grok-vision-beta → vision=true', () => {
    const r = inferCapabilities('grok-vision-beta');
    expect(r?.matchedPattern).toBe('grok-vision');
    expect(r?.capabilities.vision).toBe(true);
  });

  it('deepseek-reasoner → reasoning=true', () => {
    const r = inferCapabilities('deepseek-reasoner');
    expect(r?.capabilities.reasoning).toBe(true);
  });

  it('claude-haiku-3.5-latest → vision=true via claude-haiku', () => {
    const r = inferCapabilities('claude-haiku-3.5-latest');
    expect(r?.matchedPattern).toBe('claude-haiku');
    expect(r?.capabilities.vision).toBe(true);
  });

  it('gemini-2.5-pro → reasoning=true', () => {
    const r = inferCapabilities('gemini-2.5-pro');
    expect(r?.matchedPattern).toBe('gemini-2.5-pro');
    expect(r?.capabilities.reasoning).toBe(true);
  });

  it('gemini-2.5-flash → matches gemini-2.5 (not -pro)', () => {
    const r = inferCapabilities('gemini-2.5-flash');
    expect(r?.matchedPattern).toBe('gemini-2.5');
    expect(r?.capabilities.reasoning).toBe(false);
  });
});

describe('inferCapabilities — pattern collisions', () => {
  it('no two patterns share the same length', () => {
    const entries = __getInferenceEntriesForTest();
    const byLength: Record<number, string[]> = {};
    for (const entry of entries) {
      const key = entry.pattern.length;
      if (!byLength[key]) {
        byLength[key] = [];
      }
      byLength[key].push(entry.pattern);
    }
    const collisions: string[] = [];
    for (const key of Object.keys(byLength)) {
      const patterns = byLength[Number(key)];
      const unique = new Set(patterns);
      if (unique.size < patterns.length) {
        collisions.push(`length ${key}: ${patterns.join(', ')}`);
      }
    }
    expect(collisions).toEqual([]);
  });

  it('every pattern is unique', () => {
    const entries = __getInferenceEntriesForTest();
    const patterns = entries.map((e) => e.pattern);
    expect(new Set(patterns).size).toBe(patterns.length);
  });
});

describe('resolveCapabilities', () => {
  it('returns unknown when no specs and model not in inference table', () => {
    expect(resolveCapabilities('openAI', 'custom-xyz-v1')).toEqual({ source: 'unknown' });
  });

  it('returns explicit when matching spec exists', () => {
    const specs = [spec('openAI', 'gpt-4o', FULL)];
    const r = resolveCapabilities('openAI', 'gpt-4o', specs);
    expect(r.source).toBe('explicit');
    if (r.source === 'explicit') {
      expect(r.capabilities).toBe(FULL);
    }
  });

  it('returns inferred when spec present but capabilities absent on spec', () => {
    const specs = [spec('openAI', 'gpt-4o')];
    const r = resolveCapabilities('openAI', 'gpt-4o', specs);
    expect(r.source).toBe('inferred');
    if (r.source === 'inferred') {
      expect(r.matchedPattern).toBe('gpt-4o');
    }
  });

  it('returns inferred when specs do not match the (provider, model) pair', () => {
    const specs = [spec('anthropic', 'claude-3-opus', FULL)];
    const r = resolveCapabilities('openAI', 'gpt-4o', specs);
    expect(r.source).toBe('inferred');
  });

  it('explicit takes priority over inference even if inference would return a richer capability set', () => {
    const restrictive: ModelCapabilities = { ...FULL, vision: false };
    const specs = [spec('openAI', 'gpt-4o', restrictive)];
    const r = resolveCapabilities('openAI', 'gpt-4o', specs);
    expect(r.source).toBe('explicit');
    if (r.source === 'explicit') {
      expect(r.capabilities.vision).toBe(false);
    }
  });

  it('provider mismatch falls through to inference', () => {
    const specs = [spec('azureOpenAI', 'gpt-4o', FULL)];
    const r = resolveCapabilities('openAI', 'gpt-4o', specs);
    expect(r.source).toBe('inferred');
  });

  it('returns unknown when specs empty array', () => {
    expect(resolveCapabilities('custom', 'unknown-model', [])).toEqual({ source: 'unknown' });
  });

  it('returns unknown when specs undefined', () => {
    expect(resolveCapabilities('custom', 'unknown-model')).toEqual({ source: 'unknown' });
  });
});
