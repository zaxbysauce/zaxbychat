/**
 * @jest-environment @happy-dom/jest-environment
 */
import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { RecoilRoot } from 'recoil';
import { MAX_COUNCIL_EXTRAS } from 'librechat-data-provider';
import useCouncilState from '../useCouncilState';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <RecoilRoot>{children}</RecoilRoot>
);

describe('useCouncilState — defaults', () => {
  it('starts disabled with default strategy and no extras', () => {
    const { result } = renderHook(() => useCouncilState(), { wrapper });
    expect(result.current.state.enabled).toBe(false);
    expect(result.current.state.extras).toEqual([]);
    expect(result.current.state.strategy).toBe('compare_and_synthesize');
    expect(result.current.isFull).toBe(false);
  });
});

describe('useCouncilState — setEnabled / setStrategy', () => {
  it('toggles enabled', () => {
    const { result } = renderHook(() => useCouncilState(), { wrapper });
    act(() => result.current.setEnabled(true));
    expect(result.current.state.enabled).toBe(true);
    act(() => result.current.setEnabled(false));
    expect(result.current.state.enabled).toBe(false);
  });

  it('sets strategy', () => {
    const { result } = renderHook(() => useCouncilState(), { wrapper });
    act(() => result.current.setStrategy('best_of_three'));
    expect(result.current.state.strategy).toBe('best_of_three');
    act(() => result.current.setStrategy('primary_critic'));
    expect(result.current.state.strategy).toBe('primary_critic');
  });
});

describe('useCouncilState — addExtra / removeExtra', () => {
  it('adds a valid extra and returns true', () => {
    const { result } = renderHook(() => useCouncilState(), { wrapper });
    let added = false;
    act(() => {
      added = result.current.addExtra({ endpoint: 'anthropic', model: 'claude-opus-4-7' });
    });
    expect(added).toBe(true);
    expect(result.current.state.extras).toHaveLength(1);
  });

  it('rejects duplicate (endpoint, model, agent_id) tuple', () => {
    const { result } = renderHook(() => useCouncilState(), { wrapper });
    act(() => {
      result.current.addExtra({ endpoint: 'anthropic', model: 'claude-opus-4-7' });
    });
    let added = true;
    act(() => {
      added = result.current.addExtra({ endpoint: 'anthropic', model: 'claude-opus-4-7' });
    });
    expect(added).toBe(false);
    expect(result.current.state.extras).toHaveLength(1);
  });

  it(`caps at ${MAX_COUNCIL_EXTRAS} extras and returns false on overflow`, () => {
    const { result } = renderHook(() => useCouncilState(), { wrapper });
    act(() => {
      result.current.addExtra({ endpoint: 'anthropic', model: 'claude-opus-4-7' });
      result.current.addExtra({ endpoint: 'google', model: 'gemini-2.5-pro' });
    });
    expect(result.current.isFull).toBe(true);
    let overflowAdded = true;
    act(() => {
      overflowAdded = result.current.addExtra({ endpoint: 'xai', model: 'grok-4' });
    });
    expect(overflowAdded).toBe(false);
    expect(result.current.state.extras).toHaveLength(MAX_COUNCIL_EXTRAS);
  });

  it('rejects extras with missing endpoint or model', () => {
    const { result } = renderHook(() => useCouncilState(), { wrapper });
    let added = true;
    act(() => {
      added = result.current.addExtra({
        endpoint: '',
        model: 'gpt-4o',
      } as unknown as { endpoint: string; model: string });
    });
    expect(added).toBe(false);
    act(() => {
      added = result.current.addExtra({
        endpoint: 'openAI',
        model: '',
      } as unknown as { endpoint: string; model: string });
    });
    expect(added).toBe(false);
    expect(result.current.state.extras).toHaveLength(0);
  });

  it('removes extras by index', () => {
    const { result } = renderHook(() => useCouncilState(), { wrapper });
    act(() => {
      result.current.addExtra({ endpoint: 'anthropic', model: 'claude-opus-4-7' });
      result.current.addExtra({ endpoint: 'google', model: 'gemini-2.5-pro' });
    });
    act(() => result.current.removeExtra(0));
    expect(result.current.state.extras).toHaveLength(1);
    expect(result.current.state.extras[0].endpoint).toBe('google');
  });

  it('removeExtra on out-of-range index is a safe no-op', () => {
    const { result } = renderHook(() => useCouncilState(), { wrapper });
    act(() => {
      result.current.addExtra({ endpoint: 'anthropic', model: 'claude-opus-4-7' });
    });
    act(() => result.current.removeExtra(5));
    expect(result.current.state.extras).toHaveLength(1);
  });
});

describe('useCouncilState — reset', () => {
  it('returns state to defaults', () => {
    const { result } = renderHook(() => useCouncilState(), { wrapper });
    act(() => {
      result.current.setEnabled(true);
      result.current.setStrategy('best_of_three');
      result.current.addExtra({ endpoint: 'anthropic', model: 'claude-opus-4-7' });
    });
    act(() => result.current.reset());
    expect(result.current.state.enabled).toBe(false);
    expect(result.current.state.strategy).toBe('compare_and_synthesize');
    expect(result.current.state.extras).toEqual([]);
  });
});

describe('useCouncilState — getOutboundExtras', () => {
  it('returns null when not enabled even with extras present', () => {
    const { result } = renderHook(() => useCouncilState(), { wrapper });
    act(() => {
      result.current.addExtra({ endpoint: 'anthropic', model: 'claude-opus-4-7' });
    });
    expect(
      result.current.getOutboundExtras({ endpoint: 'openAI', model: 'gpt-4o' }),
    ).toBeNull();
  });

  it('returns null when enabled but no extras present', () => {
    const { result } = renderHook(() => useCouncilState(), { wrapper });
    act(() => result.current.setEnabled(true));
    expect(
      result.current.getOutboundExtras({ endpoint: 'openAI', model: 'gpt-4o' }),
    ).toBeNull();
  });

  it('returns extras when enabled + valid + no duplicate with primary', () => {
    const { result } = renderHook(() => useCouncilState(), { wrapper });
    act(() => {
      result.current.setEnabled(true);
      result.current.addExtra({ endpoint: 'anthropic', model: 'claude-opus-4-7' });
    });
    const outbound = result.current.getOutboundExtras({ endpoint: 'openAI', model: 'gpt-4o' });
    expect(outbound).toEqual([{ endpoint: 'anthropic', model: 'claude-opus-4-7' }]);
  });

  it('returns null when an extra duplicates the primary', () => {
    const { result } = renderHook(() => useCouncilState(), { wrapper });
    act(() => {
      result.current.setEnabled(true);
      result.current.addExtra({ endpoint: 'openAI', model: 'gpt-4o' });
    });
    expect(
      result.current.getOutboundExtras({ endpoint: 'openAI', model: 'gpt-4o' }),
    ).toBeNull();
  });
});
