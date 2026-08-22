import { PT_BR_RESEARCH_DIAGNOSTICS } from '../pt-BR';
import { describe, expect, it } from 'vitest';
import type { ConnectorContext } from '../connectors/types';
import { InMemoryRateLimiter, silentLogger } from '../memory';
import {
  DEFAULT_DOMAIN_RATE_PER_SECOND,
  rateLimitedContext,
  sourceRatePerSecond,
} from '../pipeline/rate-limit';
import type { RateLimiterPort } from '../ports';

describe('sourceRatePerSecond', () => {
  it('defaults to the conservative 2 req/s', () => {
    expect(DEFAULT_DOMAIN_RATE_PER_SECOND).toBe(2);
    expect(sourceRatePerSecond({})).toBe(2);
    expect(sourceRatePerSecond({ baseUrl: 'https://x.example' })).toBe(2);
  });

  it('honors a positive numeric override, clamped to a sane ceiling', () => {
    expect(sourceRatePerSecond({ rateLimitPerSecond: 5 })).toBe(5);
    expect(sourceRatePerSecond({ rateLimitPerSecond: 0.5 })).toBe(0.5);
    expect(sourceRatePerSecond({ rateLimitPerSecond: 10_000 })).toBe(50);
  });

  it('falls back to the default on garbage — a typo must not disable pacing', () => {
    expect(sourceRatePerSecond({ rateLimitPerSecond: 0 })).toBe(2);
    expect(sourceRatePerSecond({ rateLimitPerSecond: -3 })).toBe(2);
    expect(sourceRatePerSecond({ rateLimitPerSecond: Number.NaN })).toBe(2);
    expect(sourceRatePerSecond({ rateLimitPerSecond: '9' })).toBe(2);
  });
});

/** A recording limiter plus a recording transport, wired through the wrapper. */
const harness = () => {
  const calls = {
    acquired: [] as { key: string; rate: number }[],
    fetched: [] as string[],
    posted: [] as string[],
    postedJson: [] as string[],
    reasoned: [] as string[],
    statused: [] as string[],
  };
  const limiter: RateLimiterPort = {
    acquire: (key, rate) => {
      calls.acquired.push({ key, rate });
      return Promise.resolve();
    },
  };
  const ctx: ConnectorContext = {
    logger: silentLogger,
    diagnostics: PT_BR_RESEARCH_DIAGNOSTICS,
    fetchJson: (url) => {
      calls.fetched.push(url);
      return Promise.resolve(null);
    },
    fetchJsonResult: (url) => {
      calls.reasoned.push(url);
      return Promise.resolve({ ok: false, failure: { kind: 'transport' } });
    },
    fetchJsonStatus: (url) => {
      calls.statused.push(url);
      return Promise.resolve({ status: 403, payload: null });
    },
    postForm: (url) => {
      calls.posted.push(url);
      return Promise.resolve(null);
    },
    postJsonResult: (url) => {
      calls.postedJson.push(url);
      return Promise.resolve({ ok: false, failure: { kind: 'transport' } });
    },
  };
  return { calls, wrapped: rateLimitedContext(ctx, limiter, 2) };
};

describe('rateLimitedContext', () => {
  it('acquires the URL domain before fetching, per call', async () => {
    const { calls, wrapped } = harness();

    await wrapped.fetchJson('https://WWW.Giga.com.vc/api/a');
    await wrapped.fetchJson('https://api.mercadolibre.com/sites/MLB/search');

    expect(calls.acquired).toEqual([
      { key: 'www.giga.com.vc', rate: 2 },
      { key: 'api.mercadolibre.com', rate: 2 },
    ]);
    expect(calls.fetched).toHaveLength(2);
  });

  it('paces postForm through the same limiter — token exchanges count too', async () => {
    const { calls, wrapped } = harness();

    await wrapped.postForm?.('https://api.mercadolibre.com/oauth/token', { a: 'b' });

    expect(calls.acquired).toEqual([{ key: 'api.mercadolibre.com', rate: 2 }]);
    expect(calls.posted).toEqual(['https://api.mercadolibre.com/oauth/token']);
  });

  it('an unparsable URL skips the limiter but still reaches the transport', async () => {
    const { calls, wrapped } = harness();

    await wrapped.fetchJson('not a url');

    expect(calls.acquired).toEqual([]);
    expect(calls.fetched).toEqual(['not a url']);
  });

  it('paces the reason-carrying GET too (FUT-495) — no unmetered fetch path', async () => {
    const { calls, wrapped } = harness();

    await wrapped.fetchJsonResult?.('https://www.atacadao.com.br/api/catalog_system/x');

    expect(calls.acquired).toEqual([{ key: 'www.atacadao.com.br', rate: 2 }]);
    expect(calls.reasoned).toEqual(['https://www.atacadao.com.br/api/catalog_system/x']);
  });

  it('paces the status-carrying GET too — the middle search tier is a fetch path', async () => {
    // It began as the save-time credential probe, but `fetchJsonOutcome` made it
    // the SEARCH tier for a host without `fetchJsonResult`. Unwrapped, every
    // catalog GET, EAN fallback and regions probe such a host makes escaped the
    // limiter through the `{...ctx}` spread.
    const { calls, wrapped } = harness();

    await wrapped.fetchJsonStatus?.('https://www.atacadao.com.br/api/catalog_system/x');

    expect(calls.acquired).toEqual([{ key: 'www.atacadao.com.br', rate: 2 }]);
    expect(calls.statused).toEqual(['https://www.atacadao.com.br/api/catalog_system/x']);
  });

  it('paces the delivery POST too — the last seam that rode the spread unpaced', async () => {
    // Verified gap, fixed in FUT-516: `postJsonResult` (the FUT-514 delivery
    // simulation) was the one seam this wrapper never wrapped, so it escaped
    // per-domain pacing through the `{...ctx}` spread — one unmetered POST per
    // search, to the very storefront domain the catalog tiers just hammered.
    const { calls, wrapped } = harness();

    await wrapped.postJsonResult?.('https://www.atacadao.com.br/api/checkout/pub/orderForms/simulation', {
      items: [],
    });

    expect(calls.acquired).toEqual([{ key: 'www.atacadao.com.br', rate: 2 }]);
    expect(calls.postedJson).toHaveLength(1);
  });

  it('does not invent a postForm or a reason seam on a host that has neither', () => {
    const limiter: RateLimiterPort = { acquire: () => Promise.resolve() };
    const bare: ConnectorContext = { logger: silentLogger, fetchJson: () => Promise.resolve(null), diagnostics: PT_BR_RESEARCH_DIAGNOSTICS };
    const wrapped = rateLimitedContext(bare, limiter, 2);
    expect(wrapped.postForm).toBeUndefined();
    expect(wrapped.postJsonResult).toBeUndefined();
    expect(wrapped.fetchJsonResult).toBeUndefined();
    expect(wrapped.fetchJsonStatus).toBeUndefined();
  });
});

describe('InMemoryRateLimiter', () => {
  /**
   * Fake time: sleep records the wait and advances the clock, so nothing here
   * waits for real. `jumpBy` moves the clock without recording a wait (an
   * idle period between requests).
   */
  const makeClock = () =>
    new (class {
      readonly waits: number[] = [];
      private clockNow = 0;
      readonly paced = new InMemoryRateLimiter(
        () => this.clockNow,
        (ms) => {
          this.waits.push(ms);
          this.clockNow += ms;
          return Promise.resolve();
        },
      );
      jumpBy(ms: number): void {
        this.clockNow += ms;
      }
    })();

  it('lets the first request through and spaces the rest at 1000/rate ms', async () => {
    const clock = makeClock();

    await clock.paced.acquire('giga.com.vc', 2);
    await clock.paced.acquire('giga.com.vc', 2);
    await clock.paced.acquire('giga.com.vc', 2);

    expect(clock.waits).toEqual([500, 500]);
  });

  it('keys independently — one busy domain never delays another', async () => {
    const clock = makeClock();

    await clock.paced.acquire('giga.com.vc', 2);
    await clock.paced.acquire('atacadao.com.br', 2);

    expect(clock.waits).toEqual([]);
  });

  it('an idle period resets the pacing instead of banking a burst', async () => {
    const clock = makeClock();

    await clock.paced.acquire('giga.com.vc', 1);
    clock.jumpBy(60_000);
    await clock.paced.acquire('giga.com.vc', 1);

    expect(clock.waits).toEqual([]);
  });

  it('bounds each wait at 15s under a burst instead of queueing an unbounded tail', async () => {
    // Frozen clock + recording sleep = a genuinely concurrent burst: every
    // acquire computes its slot before any sleep elapses. 20 acquires at 1/s
    // would space the last one 19s out unbounded; the cap admits everything
    // past the bound at the bound.
    const waits: number[] = [];
    const paced = new InMemoryRateLimiter(
      () => 0,
      (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    );

    await Promise.all(Array.from({ length: 20 }, () => paced.acquire('giga.com.vc', 1)));

    expect(waits).toHaveLength(19);
    expect(Math.max(...waits)).toBe(15_000);
  });
});
