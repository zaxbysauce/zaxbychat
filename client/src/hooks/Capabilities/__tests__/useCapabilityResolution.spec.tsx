/**
 * @jest-environment @happy-dom/jest-environment
 */
import React from 'react';
import { renderHook } from '@testing-library/react';
import type { TStartupConfig, ModelCapabilities } from 'librechat-data-provider';
import useCapabilityResolution from '../useCapabilityResolution';

const mockStartupConfig: { current: TStartupConfig | undefined } = { current: undefined };

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: mockStartupConfig.current }),
}));

const FULL_CAPS: ModelCapabilities = {
  chat: true,
  vision: true,
  files: false,
  toolCalling: true,
  structuredOutput: true,
  streaming: true,
  embeddings: false,
  rerank: false,
  reasoning: false,
};

describe('useCapabilityResolution', () => {
  beforeEach(() => {
    mockStartupConfig.current = undefined;
  });

  it('returns unknown when provider or model is falsy', () => {
    const { result: a } = renderHook(() => useCapabilityResolution(undefined, 'gpt-4o'));
    expect(a.current).toEqual({ source: 'unknown' });

    const { result: b } = renderHook(() => useCapabilityResolution('openAI', undefined));
    expect(b.current).toEqual({ source: 'unknown' });
  });

  it('returns inferred for known model when no specs present', () => {
    const { result } = renderHook(() => useCapabilityResolution('openAI', 'gpt-4o'));
    expect(result.current.source).toBe('inferred');
    if (result.current.source === 'inferred') {
      expect(result.current.matchedPattern).toBe('gpt-4o');
      expect(result.current.capabilities.vision).toBe(true);
    }
  });

  it('returns unknown for model not in inference table', () => {
    const { result } = renderHook(() =>
      useCapabilityResolution('custom-endpoint', 'unknown-model-v99'),
    );
    expect(result.current).toEqual({ source: 'unknown' });
  });

  it('returns explicit when startup config has matching spec', () => {
    mockStartupConfig.current = {
      modelSpecs: {
        list: [
          {
            name: 'gpt-4o-capped',
            label: 'GPT-4o (no vision)',
            preset: { endpoint: 'openAI', model: 'gpt-4o' },
            capabilities: { ...FULL_CAPS, vision: false },
          },
        ],
      },
    } as unknown as TStartupConfig;

    const { result } = renderHook(() => useCapabilityResolution('openAI', 'gpt-4o'));
    expect(result.current.source).toBe('explicit');
    if (result.current.source === 'explicit') {
      expect(result.current.capabilities.vision).toBe(false);
    }
  });
});
