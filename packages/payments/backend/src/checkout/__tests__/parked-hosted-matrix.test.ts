import { describe, expect, it } from 'vitest';

import type { ProviderName } from '../../core/types';

import {
  cardOf,
  parkedHostedWorld,
  type Instrument,
  type PriorAttempt,
  type ProviderState,
} from './parked-hosted-world';

/**
 * FUT-4072 — THE SCENARIO MATRIX.
 *
 * A link is parked at the hosted provider `alpha` while the chain reads
 * `[alpha, beta]`. Then the owner's world changes and the buyer pays again.
 * Every combination of the axes below is one case, named by its inputs:
 *
 *   chain order (now) × alpha's state × method × prior attempt × instrument
 *   × whether alpha can void
 *
 * The expected answer comes from the owner's rule, written once below as a
 * plain spec (`expected`): a parked link is reused ONLY when a fresh walk would
 * land on its provider first — it heads the current chain, or every member
 * ahead of it is one the walk that minted it failed over from — and never over
 * an instrument minted for it (FUT-604); otherwise the current chain is walked,
 * and the link it moved past is voided where alpha can void, or marked and
 * recorded superseded where it cannot.
 */

type Order = 'alpha>beta' | 'beta>alpha';
type Method = 'PIX' | 'CARD';

interface Case {
  name: string;
  order: Order;
  alpha: ProviderState;
  method: Method;
  prior: PriorAttempt;
  instrument: Instrument;
  alphaVoids: boolean;
}

const ORDERS: Order[] = ['alpha>beta', 'beta>alpha'];
const STATES: ProviderState[] = ['enabled', 'disabled', 'removed'];
const METHODS: Method[] = ['PIX', 'CARD'];
const PRIORS: PriorAttempt[] = ['none', 'parked', 'failover', 'outage', 'expired', 'paid', 'failed'];
const INSTRUMENTS: Instrument[] = ['none', 'tokenAlpha', 'tokenBeta'];
const VOIDS = [true, false];

/** The cartesian product of the axes, flattened — one named case each. */
const buildCases = (): Case[] => ORDERS.flatMap((order) =>
  STATES.flatMap((alpha) =>
    METHODS.flatMap((method) =>
      PRIORS.flatMap((prior) =>
        INSTRUMENTS.flatMap((instrument) =>
          VOIDS.map((alphaVoids) => ({
            name:
              `chain=${order} alpha=${alpha} method=${method} prior=${prior} ` +
              `instrument=${instrument} alphaVoids=${alphaVoids}`,
            order,
            alpha,
            method,
            prior,
            instrument,
            alphaVoids,
          })),
        ),
      ),
    ),
  ),
);

/** What the owner's rule says should happen. */
interface Expected {
  reused: boolean;
  /** Where a fresh walk lands, or null when it cannot land anywhere. */
  raisedOn: ProviderName | null;
  /** What becomes of the parked link: untouched, voided, or recorded superseded. */
  parked: 'untouched' | 'voided' | 'superseded' | 'reused';
  why?: 'VOID_UNSUPPORTED' | 'VOID_FAILED';
}

function currentChain(c: Case): ProviderName[] {
  const order: ProviderName[] = c.order === 'alpha>beta' ? ['alpha', 'beta'] : ['beta', 'alpha'];
  return order.filter((provider) => provider !== 'alpha' || c.alpha === 'enabled');
}

/**
 * The walk: alpha's hosted page needs no instrument; beta skips a card minted
 * only for alpha, and is skipped outright while its outage breaker is open.
 */
function walkLands(c: Case): ProviderName | null {
  const lands = (provider: ProviderName) =>
    provider === 'alpha' || (c.prior !== 'outage' && (c.method === 'PIX' || c.instrument !== 'tokenAlpha'));
  return currentChain(c).find(lands) ?? null;
}

/**
 * Would a fresh walk land on alpha? When alpha is the first capable member —
 * or when every member ahead of it is one the walk that minted the link failed
 * over from, for the same method, AND is still down now: an `outage` link was
 * minted for PIX with beta down, and beta's breaker is still open. A `failover`
 * link whose beta is back is judged like any other.
 */
function walkWouldLandOnAlpha(c: Case): boolean {
  const rank = currentChain(c).indexOf('alpha');
  if (rank < 0) return false;
  return rank === 0 || (c.prior === 'outage' && c.method === 'PIX');
}

function expected(c: Case): Expected {
  const parkedPayable = c.prior === 'parked' || c.prior === 'failover' || c.prior === 'outage';
  if (parkedPayable && c.instrument !== 'tokenAlpha' && walkWouldLandOnAlpha(c)) {
    return { reused: true, raisedOn: null, parked: 'reused' };
  }
  const raisedOn = walkLands(c);
  if (!parkedPayable || raisedOn === null) return { reused: false, raisedOn, parked: 'untouched' };
  if (c.alphaVoids && c.alpha === 'enabled') return { reused: false, raisedOn, parked: 'voided' };
  const why = c.alpha === 'enabled' ? 'VOID_UNSUPPORTED' : 'VOID_FAILED';
  return { reused: false, raisedOn, parked: 'superseded', why };
}

/** Park the prior attempt under `[alpha, beta]`, then apply the owner's change. */
async function arrange(c: Case) {
  const world = parkedHostedWorld({ alphaVoids: c.alphaVoids });
  const parked = await world.park(c.prior);
  world.credentials.chain = c.order === 'alpha>beta' ? ['alpha', 'beta'] : ['beta', 'alpha'];
  world.credentials.alpha = c.alpha;
  return { world, parked };
}

describe('FUT-4072 — a parked hosted link against the current chain', () => {
  it('covers every combination of the axes', () => {
    const cases = buildCases();
    expect(cases).toHaveLength(504);
    expect(new Set(cases.map((c) => c.name)).size).toBe(cases.length);
  });

  it.each(buildCases())('$name', async (c) => {
    const { world, parked } = await arrange(c);
    const want = expected(c);

    const attempt = world.pay(c.method, cardOf(c.instrument));

    if (want.raisedOn === null && !want.reused) {
      await expect(attempt).rejects.toThrow();
      if (parked) expect(world.statusOf(parked)).toBe(parked.status);
      expect(world.superseded).toHaveLength(0);
      return;
    }
    const got = await attempt;
    if (want.reused) {
      expect(got.providerChargeId).toBe(parked?.providerChargeId);
      expect(world.charges.all()).toHaveLength(1);
      expect(world.superseded).toHaveLength(0);
      return;
    }
    expect(got.provider).toBe(want.raisedOn);
    expect(got.providerChargeId).not.toBe(parked?.providerChargeId);
    if (!parked) {
      expect(world.superseded).toHaveLength(0);
      return;
    }
    const after = world.statusOf(parked);
    if (want.parked === 'untouched') {
      expect(after).toBe(parked.status);
      expect(world.superseded).toHaveLength(0);
    } else if (want.parked === 'voided') {
      expect(after).toBe('CANCELED');
      expect(world.superseded).toHaveLength(0);
    } else {
      expect(after).toBe('PENDING');
      expect(world.superseded).toHaveLength(1);
      expect(world.superseded[0]?.snapshot.providerChargeId).toBe(parked.providerChargeId);
      expect(world.superseded[0]?.replacedBy.providerChargeId).toBe(got.providerChargeId);
      expect(world.superseded[0]?.why).toBe(want.why);
      expect(world.charges.all().find((r) => r.providerChargeId === parked.providerChargeId)?.snapshot.superseded)
        .toMatchObject({ replacedBy: got.providerChargeId, why: want.why });
    }
    // The invariant underneath every case: no payable charge is left that is
    // neither the buyer's answer nor recorded as superseded.
    const recorded = new Set(world.superseded.map((s) => s.snapshot.providerChargeId));
    const unaccounted = world.charges
      .all()
      .filter((row) => row.snapshot.status === 'PENDING')
      .filter((row) => row.providerChargeId !== got.providerChargeId && !recorded.has(row.providerChargeId));
    expect(unaccounted).toEqual([]);
  });
});
