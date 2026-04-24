/**
 * Per-leg transaction-row threading tests (Phase 4 §V4c).
 *
 * Verifies that `agentId` added to UsageMetadata flows through
 * recordCollectedUsage → TxMetadata → prepared doc → bulk insertMany
 * without being dropped or coalesced. This is the foundation of the
 * council pricing-parity gate: K successful legs + 1 synthesis ⇒
 * K+1 transaction rows, each with its own agentId.
 */
import { prepareTokenSpend, prepareStructuredTokenSpend } from '../transactions';
import { recordCollectedUsage } from '../usage';
import type { PricingFns, TxMetadata } from '../transactions';
import type { UsageMetadata } from '../../stream/interfaces/IJobStore';

const pricing: PricingFns = {
  getMultiplier: () => 1,
  getCacheMultiplier: () => null,
};

const baseMeta: TxMetadata = {
  user: 'u1',
  conversationId: 'c1',
  context: 'message',
  balance: { enabled: true },
  transactions: { enabled: true },
};

describe('prepareTokenSpend — carries agentId on the doc', () => {
  it('carries agentId from TxMetadata to the prepared doc', () => {
    const meta: TxMetadata = { ...baseMeta, model: 'gpt-4o', agentId: 'leg-0' };
    const results = prepareTokenSpend(
      meta,
      { promptTokens: 100, completionTokens: 50 },
      pricing,
    );
    expect(results).toHaveLength(2);
    for (const entry of results) {
      expect((entry.doc as unknown as { agentId?: string }).agentId).toBe('leg-0');
    }
  });

  it('omits agentId when TxMetadata has none', () => {
    const meta: TxMetadata = { ...baseMeta, model: 'gpt-4o' };
    const results = prepareTokenSpend(
      meta,
      { promptTokens: 100, completionTokens: 50 },
      pricing,
    );
    for (const entry of results) {
      expect((entry.doc as unknown as { agentId?: string }).agentId).toBeUndefined();
    }
  });
});

describe('prepareStructuredTokenSpend — carries agentId on the doc', () => {
  it('propagates agentId through structured tx prep', () => {
    const meta: TxMetadata = { ...baseMeta, model: 'claude-opus-4-7', agentId: 'leg-1' };
    const results = prepareStructuredTokenSpend(
      meta,
      {
        promptTokens: { input: 100, write: 20, read: 10 },
        completionTokens: 50,
      },
      pricing,
    );
    for (const entry of results) {
      expect((entry.doc as unknown as { agentId?: string }).agentId).toBe('leg-1');
    }
  });
});

describe('recordCollectedUsage — each entry produces a distinct row with its own agentId', () => {
  function make() {
    const writtenDocs: unknown[] = [];
    const insertMany = jest.fn(async (docs: unknown[]) => {
      writtenDocs.push(...docs);
    });
    const updateBalance = jest.fn(async () => undefined);
    const deps = {
      spendTokens: jest.fn(),
      spendStructuredTokens: jest.fn(),
      pricing,
      bulkWriteOps: { insertMany, updateBalance },
    };
    return { deps, writtenDocs, insertMany };
  }

  it('produces K+1 rows for K legs + 1 synthesis when all entries carry distinct agentIds', async () => {
    const { deps, writtenDocs, insertMany } = make();

    const collected: UsageMetadata[] = [
      { input_tokens: 100, output_tokens: 50, model: 'gpt-4o', agentId: 'leg-0' },
      { input_tokens: 120, output_tokens: 60, model: 'claude-opus-4-7', agentId: 'leg-1' },
      { input_tokens: 150, output_tokens: 70, model: 'gemini-2.5-pro', agentId: 'leg-2' },
      { input_tokens: 300, output_tokens: 200, model: 'gpt-4o', agentId: '__synthesis__' },
    ];

    await recordCollectedUsage(deps, {
      user: 'u1',
      conversationId: 'c1',
      collectedUsage: collected,
      model: 'gpt-4o',
    });

    expect(insertMany).toHaveBeenCalledTimes(1);
    const agentIds = new Set(
      (writtenDocs as Array<{ agentId?: string }>)
        .filter((d) => d.tokenType === 'prompt' || true)
        .map((d) => d.agentId),
    );
    expect(agentIds.has('leg-0')).toBe(true);
    expect(agentIds.has('leg-1')).toBe(true);
    expect(agentIds.has('leg-2')).toBe(true);
    expect(agentIds.has('__synthesis__')).toBe(true);
    expect(agentIds.size).toBe(4);

    // Each leg produces 2 rows (prompt + completion) = 8 total rows for 3 legs + synthesis.
    expect(writtenDocs).toHaveLength(8);
    const synthesisDocs = (writtenDocs as Array<{ agentId?: string; model?: string }>).filter(
      (d) => d.agentId === '__synthesis__',
    );
    expect(synthesisDocs).toHaveLength(2);
    expect(synthesisDocs.every((d) => d.model === 'gpt-4o')).toBe(true);
  });

  it('omits agentId on rows when usage entry has no agentId (non-council path unchanged)', async () => {
    const { deps, writtenDocs } = make();

    await recordCollectedUsage(deps, {
      user: 'u1',
      conversationId: 'c1',
      collectedUsage: [{ input_tokens: 100, output_tokens: 50, model: 'gpt-4o' }],
      model: 'gpt-4o',
    });

    for (const doc of writtenDocs as Array<{ agentId?: string }>) {
      expect(doc.agentId).toBeUndefined();
    }
  });

  it('produces K rows (no synthesis) when synthesis was skipped in all-fail case', async () => {
    const { deps, writtenDocs } = make();

    // Council ran 2 legs, both "failed mid-stream" but accumulated some usage
    // before failing. Synthesis was skipped because all legs failed, so no
    // synthesis entry exists. Result: exactly 2 legs × 2 rows = 4 rows.
    const collected: UsageMetadata[] = [
      { input_tokens: 60, output_tokens: 0, model: 'gpt-4o', agentId: 'leg-0' },
      { input_tokens: 70, output_tokens: 0, model: 'claude-opus-4-7', agentId: 'leg-1' },
    ];

    await recordCollectedUsage(deps, {
      user: 'u1',
      conversationId: 'c1',
      collectedUsage: collected,
      model: 'gpt-4o',
    });

    expect(writtenDocs).toHaveLength(4);
    const synthesisDocs = (writtenDocs as Array<{ agentId?: string }>).filter(
      (d) => d.agentId === '__synthesis__',
    );
    expect(synthesisDocs).toHaveLength(0);
  });
});
