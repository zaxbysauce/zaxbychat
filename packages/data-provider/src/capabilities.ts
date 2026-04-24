import type { ModelCapabilities, TModelSpec } from './models';

export type CapabilitySource = 'explicit' | 'inferred' | 'unknown';

/**
 * Result of resolving per-model capabilities.
 * - `explicit`: sourced from an operator-authored TModelSpec.capabilities entry.
 * - `inferred`: sourced from the conservative builtin inference table; honest but
 *   non-authoritative — treat `false` as "likely but unverified".
 * - `unknown`: no match in specs, no match in the inference table. Callers preserve
 *   compatibility by default; strict-mode callers may escalate.
 */
export type CapabilityResolution =
  | { source: 'explicit'; capabilities: ModelCapabilities }
  | { source: 'inferred'; capabilities: ModelCapabilities; matchedPattern: string }
  | { source: 'unknown' };

interface InferenceEntry {
  pattern: string;
  capabilities: ModelCapabilities;
}

/**
 * Builtin conservative inference table — best-effort enrichment only.
 *
 * Matching is case-insensitive substring (`model.toLowerCase().includes(pattern)`);
 * when multiple patterns match, the LONGEST pattern wins. Collisions between
 * same-length patterns must never happen — every entry's pattern is unique and
 * tests assert that explicitly.
 *
 * Do not expand opportunistically. Add a row only when a family's real-world
 * capabilities are unambiguous and the pattern cannot collide with a different
 * family's model name.
 */
const INFERENCE_TABLE: InferenceEntry[] = [
  {
    pattern: 'gpt-5-pro',
    capabilities: cap({ vision: true, reasoning: true }),
  },
  {
    pattern: 'gpt-5',
    capabilities: cap({ vision: true }),
  },
  {
    pattern: 'gpt-4.1',
    capabilities: cap({ vision: true }),
  },
  {
    pattern: 'gpt-4o',
    capabilities: cap({ vision: true }),
  },
  {
    pattern: 'o1-mini',
    capabilities: cap({ toolCalling: false, reasoning: true }),
  },
  {
    pattern: 'o1-preview',
    capabilities: cap({ toolCalling: false, reasoning: true }),
  },
  {
    pattern: 'o1',
    capabilities: cap({ vision: true, reasoning: true }),
  },
  {
    pattern: 'o3-mini',
    capabilities: cap({ reasoning: true }),
  },
  {
    pattern: 'o3',
    capabilities: cap({ vision: true, reasoning: true }),
  },
  {
    pattern: 'o4-mini',
    capabilities: cap({ vision: true, reasoning: true }),
  },
  {
    pattern: 'claude-opus-4-7',
    capabilities: cap({ vision: true, reasoning: true }),
  },
  {
    pattern: 'claude-opus-4-6',
    capabilities: cap({ vision: true, reasoning: true }),
  },
  {
    pattern: 'claude-opus',
    capabilities: cap({ vision: true }),
  },
  {
    pattern: 'claude-sonnet',
    capabilities: cap({ vision: true }),
  },
  {
    pattern: 'claude-haiku',
    capabilities: cap({ vision: true }),
  },
  {
    pattern: 'claude-3',
    capabilities: cap({ vision: true }),
  },
  {
    pattern: 'gemini-2.5-pro',
    capabilities: cap({ vision: true, reasoning: true }),
  },
  {
    pattern: 'gemini-2.5',
    capabilities: cap({ vision: true }),
  },
  {
    pattern: 'gemini-2',
    capabilities: cap({ vision: true }),
  },
  {
    pattern: 'gemini-1.5',
    capabilities: cap({ vision: true }),
  },
  {
    pattern: 'grok-vision',
    capabilities: cap({ vision: true }),
  },
  {
    pattern: 'grok-2-vision',
    capabilities: cap({ vision: true }),
  },
  {
    pattern: 'grok-4',
    capabilities: cap({ vision: true }),
  },
  {
    pattern: 'deepseek-reasoner',
    capabilities: cap({ reasoning: true }),
  },
  {
    pattern: 'deepseek-r1',
    capabilities: cap({ reasoning: true }),
  },
];

/** Defaults applied when an inference entry does not explicitly override a field. */
function cap(overrides: Partial<ModelCapabilities>): ModelCapabilities {
  return {
    chat: true,
    vision: false,
    files: false,
    toolCalling: true,
    structuredOutput: true,
    streaming: true,
    embeddings: false,
    rerank: false,
    reasoning: false,
    ...overrides,
  };
}

/**
 * Returns inferred capabilities for a model name, or null if no pattern matches.
 * Longest-match-wins across the builtin table.
 */
export function inferCapabilities(
  model: string,
): { capabilities: ModelCapabilities; matchedPattern: string } | null {
  if (!model) {
    return null;
  }
  const lower = model.toLowerCase();
  let best: InferenceEntry | null = null;
  for (const entry of INFERENCE_TABLE) {
    if (!lower.includes(entry.pattern)) {
      continue;
    }
    if (best === null || entry.pattern.length > best.pattern.length) {
      best = entry;
    }
  }
  if (!best) {
    return null;
  }
  return { capabilities: best.capabilities, matchedPattern: best.pattern };
}

/**
 * Resolves per-model capabilities in priority order:
 *   1. Explicit — a TModelSpec whose preset matches (provider, model) with capabilities defined.
 *   2. Inferred — longest-match in the builtin inference table.
 *   3. Unknown — neither source matched.
 */
export function resolveCapabilities(
  provider: string,
  model: string,
  specs?: TModelSpec[],
): CapabilityResolution {
  if (specs && specs.length > 0) {
    for (const spec of specs) {
      if (!spec.capabilities) {
        continue;
      }
      const preset = spec.preset;
      if (!preset) {
        continue;
      }
      if (preset.endpoint === provider && preset.model === model) {
        return { source: 'explicit', capabilities: spec.capabilities };
      }
    }
  }
  const inferred = inferCapabilities(model);
  if (inferred) {
    return {
      source: 'inferred',
      capabilities: inferred.capabilities,
      matchedPattern: inferred.matchedPattern,
    };
  }
  return { source: 'unknown' };
}

/**
 * Test-only accessor exposing the builtin inference entries, so tests can assert
 * there are no same-length pattern collisions without reaching into module internals.
 */
export function __getInferenceEntriesForTest(): ReadonlyArray<InferenceEntry> {
  return INFERENCE_TABLE;
}
