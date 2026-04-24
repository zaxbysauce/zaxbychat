import { SYNTHESIS_AGENT_ID } from 'librechat-data-provider';
import { buildSynthesisEdge, isSynthesisAgentId } from '../graph';

describe('buildSynthesisEdge', () => {
  it('creates a scalar from for single-leg input', () => {
    const e = buildSynthesisEdge(['primary____0']);
    expect(e.from).toBe('primary____0');
    expect(e.to).toBe(SYNTHESIS_AGENT_ID);
  });

  it('creates an array from for multi-leg input', () => {
    const e = buildSynthesisEdge(['primary____0', 'extra____1', 'extra____2']);
    expect(e.from).toEqual(['primary____0', 'extra____1', 'extra____2']);
    expect(e.to).toBe(SYNTHESIS_AGENT_ID);
  });

  it('deduplicates agent ids while preserving first-seen order', () => {
    const e = buildSynthesisEdge(['a', 'b', 'a', 'c', 'b']);
    expect(e.from).toEqual(['a', 'b', 'c']);
  });

  it('filters empty strings', () => {
    const e = buildSynthesisEdge(['a', '', 'b']);
    expect(e.from).toEqual(['a', 'b']);
  });

  it('throws on empty input', () => {
    expect(() => buildSynthesisEdge([])).toThrow();
  });

  it('throws when only empty strings remain after dedup', () => {
    expect(() => buildSynthesisEdge(['', '', ''])).toThrow();
  });
});

describe('isSynthesisAgentId', () => {
  it('returns true for SYNTHESIS_AGENT_ID', () => {
    expect(isSynthesisAgentId(SYNTHESIS_AGENT_ID)).toBe(true);
  });

  it('returns false for normal agent ids', () => {
    expect(isSynthesisAgentId('primary____0')).toBe(false);
    expect(isSynthesisAgentId('anthropic__claude-opus-4-7____1')).toBe(false);
  });

  it('returns false for undefined/null/empty', () => {
    expect(isSynthesisAgentId(undefined)).toBe(false);
    expect(isSynthesisAgentId(null)).toBe(false);
    expect(isSynthesisAgentId('')).toBe(false);
  });
});
