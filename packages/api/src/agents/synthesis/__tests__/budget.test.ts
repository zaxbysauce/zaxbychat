import { estimateCouncilBudget } from '../budget';

describe('estimateCouncilBudget', () => {
  it('returns no synthesis estimate when there are no extras', () => {
    const result = estimateCouncilBudget({
      primary: { endpoint: 'openAI', model: 'gpt-4o' },
      extras: [],
      strategy: 'compare_and_synthesize',
    });
    expect(result.synthesis).toBeNull();
    expect(result.perLeg).toHaveLength(1);
    expect(result.perLeg[0].model).toBe('gpt-4o');
    expect(result.totalEstimatedTokens).toBe(result.perLeg[0].estimatedCompletionTokens);
    expect(result.approximate).toBe(true);
  });

  it('includes one perLeg entry for primary + each extra', () => {
    const result = estimateCouncilBudget({
      primary: { endpoint: 'openAI', model: 'gpt-4o' },
      extras: [
        { endpoint: 'anthropic', model: 'claude-opus-4-7' },
        { endpoint: 'google', model: 'gemini-2.5-pro' },
      ],
      strategy: 'compare_and_synthesize',
    });
    expect(result.perLeg).toHaveLength(3);
    expect(result.perLeg[0].model).toBe('gpt-4o');
    expect(result.perLeg[1].model).toBe('claude-opus-4-7');
    expect(result.perLeg[2].model).toBe('gemini-2.5-pro');
  });

  it('includes a synthesis entry whose model matches the primary when extras present', () => {
    const result = estimateCouncilBudget({
      primary: { endpoint: 'openAI', model: 'gpt-4o' },
      extras: [{ endpoint: 'anthropic', model: 'claude-opus-4-7' }],
      strategy: 'compare_and_synthesize',
    });
    expect(result.synthesis).not.toBeNull();
    expect(result.synthesis?.model).toBe('gpt-4o');
    expect(result.synthesis?.endpoint).toBe('openAI');
    expect(result.synthesis?.estimatedPromptTokens).toBeGreaterThan(0);
    expect(result.synthesis?.estimatedCompletionTokens).toBeGreaterThan(0);
  });

  it('total equals leg completions plus synthesis prompt + completion when synthesis runs', () => {
    const result = estimateCouncilBudget({
      primary: { endpoint: 'openAI', model: 'gpt-4o' },
      extras: [{ endpoint: 'anthropic', model: 'claude-opus-4-7' }],
      strategy: 'compare_and_synthesize',
    });
    const legTotal = result.perLeg.reduce(
      (s, l) => s + l.estimatedCompletionTokens,
      0,
    );
    expect(result.totalEstimatedTokens).toBe(
      legTotal +
        (result.synthesis?.estimatedPromptTokens ?? 0) +
        (result.synthesis?.estimatedCompletionTokens ?? 0),
    );
  });

  it('falls back to default completion tokens when model is unknown', () => {
    const result = estimateCouncilBudget({
      primary: { endpoint: 'customProvider', model: 'unknown-xyz' },
      extras: [],
      strategy: 'compare_and_synthesize',
    });
    expect(result.perLeg[0].estimatedCompletionTokens).toBeGreaterThan(0);
  });

  it('respects userQuestionChars in synthesis prompt estimate', () => {
    const small = estimateCouncilBudget({
      primary: { endpoint: 'openAI', model: 'gpt-4o' },
      extras: [{ endpoint: 'anthropic', model: 'claude-opus-4-7' }],
      strategy: 'compare_and_synthesize',
      userQuestionChars: 100,
    });
    const large = estimateCouncilBudget({
      primary: { endpoint: 'openAI', model: 'gpt-4o' },
      extras: [{ endpoint: 'anthropic', model: 'claude-opus-4-7' }],
      strategy: 'compare_and_synthesize',
      userQuestionChars: 10000,
    });
    expect(large.synthesis!.estimatedPromptTokens).toBeGreaterThan(
      small.synthesis!.estimatedPromptTokens,
    );
  });

  it('approximate is always true (never removed by callers)', () => {
    const result = estimateCouncilBudget({
      primary: { endpoint: 'openAI', model: 'gpt-4o' },
      extras: [{ endpoint: 'anthropic', model: 'claude-opus-4-7' }],
      strategy: 'compare_and_synthesize',
    });
    expect(result.approximate).toBe(true);
  });
});
