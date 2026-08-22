import { PT_BR_RESEARCH_DIAGNOSTICS } from '../pt-BR';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ConnectorContext, FetchInit, FetchOutcome } from '../connectors/types';
import { silentLogger } from '../memory';
import {
  budgetedContext,
  hitCeiling,
  sourceCeilingError,
  sourceDeadlineAt,
} from '../pipeline/source-budget';

/**
 * FUT-516: the per-source wall-clock ceiling, at the seam it is enforced on.
 *
 * The unit under test is the CONTEXT WRAPPER, not a connector: the whole point
 * of putting the ceiling here rather than in a `Promise.race` is that a
 * connector needs no change and unwinds naturally, so what has to be pinned is
 * that every seam carries the deadline, that a spent deadline costs no network
 * call, and that each seam refuses in ITS OWN vocabulary.
 */

const CLOCK_BASE = new Date('2026-07-31T09:00:00Z').getTime();
const BUDGET_MS = 60_000;

/** Every seam's calls, on a container — never a reassigned closed-over binding. */
interface Seen {
  fetchJson: FetchInit[];
  fetchJsonResult: FetchInit[];
  fetchJsonStatus: FetchInit[];
  postForm: FetchInit[];
  postJsonResult: FetchInit[];
}

const answered: FetchOutcome = { ok: true, payload: { ok: 1 } };

const fullContext = (seen: Seen): ConnectorContext => ({
  logger: silentLogger,
  diagnostics: PT_BR_RESEARCH_DIAGNOSTICS,
  fetchJson: (_url, init) => {
    seen.fetchJson.push(init ?? {});
    return Promise.resolve({ ok: 1 });
  },
  fetchJsonResult: (_url, init) => {
    seen.fetchJsonResult.push(init ?? {});
    return Promise.resolve(answered);
  },
  fetchJsonStatus: (_url, init) => {
    seen.fetchJsonStatus.push(init ?? {});
    return Promise.resolve({ status: 200, payload: { ok: 1 } });
  },
  postForm: (_url, _form, init) => {
    seen.postForm.push(init ?? {});
    return Promise.resolve({ ok: 1 });
  },
  postJsonResult: (_url, _body, init) => {
    seen.postJsonResult.push(init ?? {});
    return Promise.resolve(answered);
  },
});

const emptySeen = (): Seen => ({
  fetchJson: [],
  fetchJsonResult: [],
  fetchJsonStatus: [],
  postForm: [],
  postJsonResult: [],
});

const seenTotal = (seen: Seen): number =>
  Object.values(seen).reduce((total, calls) => total + calls.length, 0);

afterEach(() => {
  vi.useRealTimers();
});

describe('sourceDeadlineAt / hitCeiling', () => {
  it('is the start plus the budget, and is not hit until it passes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(CLOCK_BASE);
    const deadlineAt = sourceDeadlineAt(CLOCK_BASE, BUDGET_MS);

    expect(deadlineAt).toBe(CLOCK_BASE + BUDGET_MS);
    expect(hitCeiling(deadlineAt)).toBe(false);

    vi.setSystemTime(CLOCK_BASE + BUDGET_MS - 1);
    expect(hitCeiling(deadlineAt)).toBe(false);

    // The instant itself counts as spent: at the ceiling there is nothing left
    // to spend, and `fetchHop` refuses a zero remainder for the same reason.
    vi.setSystemTime(CLOCK_BASE + BUDGET_MS);
    expect(hitCeiling(deadlineAt)).toBe(true);
  });
});

describe('budgetedContext — the deadline on every seam', () => {
  it('stamps deadlineAt on all five seams while the budget is alive', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(CLOCK_BASE);
    const seen = emptySeen();
    const deadlineAt = sourceDeadlineAt(CLOCK_BASE, BUDGET_MS);
    const ctx = budgetedContext(fullContext(seen), deadlineAt);

    await ctx.fetchJson('https://store.example/a');
    await ctx.fetchJsonResult?.('https://store.example/b');
    await ctx.fetchJsonStatus?.('https://store.example/c');
    await ctx.postForm?.('https://store.example/d', { grant_type: 'x' });
    await ctx.postJsonResult?.('https://store.example/e', { items: [] });

    expect(seenTotal(seen)).toBe(5);
    for (const calls of Object.values(seen)) {
      expect(calls).toHaveLength(1);
      expect(calls[0]?.deadlineAt).toBe(deadlineAt);
    }
  });

  it("preserves a connector's own timeoutMs and headers (FUT-502 survives)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(CLOCK_BASE);
    const seen = emptySeen();
    const ctx = budgetedContext(fullContext(seen), sourceDeadlineAt(CLOCK_BASE, BUDGET_MS));

    await ctx.fetchJsonResult?.('https://api.searchapi.io/search', {
      timeoutMs: 20_000,
      headers: { 'X-VTEX-API-AppKey': 'secret' },
      credentialsRequired: true,
    });

    const init = seen.fetchJsonResult[0];
    expect(init?.timeoutMs).toBe(20_000);
    expect(init?.headers).toEqual({ 'X-VTEX-API-AppKey': 'secret' });
    expect(init?.credentialsRequired).toBe(true);
    expect(init?.deadlineAt).toBe(CLOCK_BASE + BUDGET_MS);
  });

  it('leaves an unmounted seam unmounted — it must not invent one', () => {
    const bare: ConnectorContext = { logger: silentLogger, fetchJson: () => Promise.resolve(null), diagnostics: PT_BR_RESEARCH_DIAGNOSTICS };
    const ctx = budgetedContext(bare, sourceDeadlineAt(CLOCK_BASE, BUDGET_MS));

    expect(ctx.fetchJsonResult).toBeUndefined();
    expect(ctx.fetchJsonStatus).toBeUndefined();
    expect(ctx.postForm).toBeUndefined();
    expect(ctx.postJsonResult).toBeUndefined();
  });
});

describe('budgetedContext — past the ceiling', () => {
  it('short-circuits the remaining exchanges without one network call', async () => {
    // Six sequential exchanges, the ceiling crossed after the second: the shape
    // of the pathological VTEX search this ticket exists to bound.
    vi.useFakeTimers();
    vi.setSystemTime(CLOCK_BASE);
    const seen = emptySeen();
    const deadlineAt = sourceDeadlineAt(CLOCK_BASE, BUDGET_MS);
    const ctx = budgetedContext(fullContext(seen), deadlineAt);

    await ctx.fetchJsonResult?.('https://store.example/regions');
    vi.setSystemTime(CLOCK_BASE + 30_000);
    await ctx.fetchJsonResult?.('https://store.example/intelligent-search');
    // The budget runs out here — the four remaining tiers must cost nothing.
    vi.setSystemTime(CLOCK_BASE + BUDGET_MS + 1);
    await ctx.fetchJsonResult?.('https://store.example/ean-fallback');
    await ctx.fetchJsonResult?.('https://store.example/legacy-catalog');
    await ctx.fetchJson('https://store.example/legacy-fallback');
    await ctx.postJsonResult?.('https://store.example/simulation', { items: [] });

    expect(seen.fetchJsonResult).toHaveLength(2);
    expect(seenTotal(seen)).toBe(2);
  });

  it('refuses in each seam\'s own vocabulary: a reason where there is one, null where there is not', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(CLOCK_BASE);
    const seen = emptySeen();
    const ctx = budgetedContext(fullContext(seen), sourceDeadlineAt(CLOCK_BASE, BUDGET_MS));
    vi.setSystemTime(CLOCK_BASE + BUDGET_MS);

    // Reason-carrying seams say WHY — a dedicated `deadline`, never `transport`
    // (which is documented as "nothing answered at all") and never `timeout`.
    const refusal = { ok: false, failure: { kind: 'deadline' } };
    await expect(ctx.fetchJsonResult?.('https://store.example/a')).resolves.toEqual(refusal);
    await expect(ctx.postJsonResult?.('https://store.example/b', {})).resolves.toEqual(refusal);

    // The legacy seams have no vocabulary for a reason at all, so they answer
    // the same `null` they answer for every other failure — the seam's whole
    // resolution. Telling a deadline apart is what mounting the reason seam
    // buys, which is exactly the trade `fetchJsonOutcome` already documents.
    await expect(ctx.fetchJson('https://store.example/c')).resolves.toBeNull();
    await expect(ctx.fetchJsonStatus?.('https://store.example/d')).resolves.toBeNull();
    await expect(ctx.postForm?.('https://store.example/e', {})).resolves.toBeNull();

    expect(seenTotal(seen)).toBe(0);
  });
});

describe('sourceCeilingError(PT_BR_RESEARCH_DIAGNOSTICS.budget)', () => {
  it('is pt-BR, blames the ceiling, and names no url, endpoint or query string', () => {
    expect(sourceCeilingError(PT_BR_RESEARCH_DIAGNOSTICS.budget)).toContain('tempo total permitido');
    expect(sourceCeilingError(PT_BR_RESEARCH_DIAGNOSTICS.budget)).not.toContain('http');
    expect(sourceCeilingError(PT_BR_RESEARCH_DIAGNOSTICS.budget)).not.toContain('://');
    expect(sourceCeilingError(PT_BR_RESEARCH_DIAGNOSTICS.budget)).not.toContain('?');
    expect(sourceCeilingError(PT_BR_RESEARCH_DIAGNOSTICS.budget)).not.toContain('=');
  });
});
