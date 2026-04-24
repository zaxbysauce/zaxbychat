import { modelCapabilitiesSchema } from '../models';
import type { ModelCapabilities } from '../models';

const fullCapabilities: ModelCapabilities = {
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

describe('modelCapabilitiesSchema', () => {
  it('validates a full capabilities object', () => {
    const result = modelCapabilitiesSchema.safeParse(fullCapabilities);
    expect(result.success).toBe(true);
  });

  it('rejects missing required fields', () => {
    const { chat: _removed, ...partial } = fullCapabilities;
    const result = modelCapabilitiesSchema.safeParse(partial);
    expect(result.success).toBe(false);
  });

  it('rejects non-boolean values', () => {
    const result = modelCapabilitiesSchema.safeParse({ ...fullCapabilities, vision: 'yes' });
    expect(result.success).toBe(false);
  });

  it('accepts all-false capabilities', () => {
    const minimal: ModelCapabilities = {
      chat: false,
      vision: false,
      files: false,
      toolCalling: false,
      structuredOutput: false,
      streaming: false,
      embeddings: false,
      rerank: false,
      reasoning: false,
    };
    const result = modelCapabilitiesSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });
});
