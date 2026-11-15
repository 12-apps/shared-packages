import { describe, expect, it, vi } from 'vitest';

import { CaptureError, type BindTarget, type TerminalCaptureRecord } from '../model';
import { createTypedCaptureClaims, heldAnswer, typedRefusalOf, type TypedBookAnswer, type TypedCaptureInput } from '../typed-booking';
import { OTHER_TENANT, TENANT, capture, wire, world, type World } from './world';

/**
 * FUT-4997 contract rows D9-R11 to D9-R23 (package half): a typed capture
 * booked as a sale of its own, idempotent on its code, by a CALLER held in
 * memory — its session, its policy, its sales keyed by the capture's code —
 * that follows the documented steps: ask `claimable`, write its own sale in
 * its own transaction, `bind` on that handle, and on a lost race roll back and
 * ask again.
 */

/** The sale the caller writes for one capture: no line, one payment row, sold by the terminal. */
interface StandaloneSale<TSession> {
  clientId: string;
  deviceId: string;
  session: TSession;
  capture: TerminalCaptureRecord;
}

/** How often the caller decides again after a lost transaction: the second read sees the winner. */
const BOOK_ATTEMPTS = 3;

interface SessionRow {
  id: string;
}

interface HostOptions {
  /** The session the station books on; null: none is open. */
  session?: SessionRow | null;
  policy?: { ok: true } | { ok: false; reason: string };
  /** The host's key is read outside the racing transaction: the bind is the only guard left. */
  blindKey?: boolean;
  /** Hold every transaction until this many pages reached it: both decided on the same read. */
  barrier?: number;
  /** The host's sale write fails with this. */
  saleFails?: Error;
  /** The host's sale write fails once with this, and the host calls it a race. */
  saleRacesOnce?: Error;
  /** Runs when the session is looked up: a move another request lands between the booking's read and its transaction. */
  meanwhile?: (made: World) => Promise<void>;
}

/** The host's tables behind the ports: the sales booked per code, rolled back with the capture rows. */
function host(made: World, options: HostOptions = {}) {
  const booked = new Map<string, BindTarget>();
  const sold: Array<StandaloneSale<SessionRow>> = [];
  const live = { session: options.session === undefined ? { id: 'session-1' } : options.session, policy: options.policy ?? { ok: true as const } };
  const order: Array<Promise<unknown>> = [];
  const raced = new Set<Error>();
  const arrived: Array<() => void> = [];
  const gate = (): Promise<void> =>
    new Promise<void>((resolve) => {
      arrived.push(resolve);
      if (arrived.length >= (options.barrier ?? 1)) arrived.splice(0).forEach((release) => release());
    });
  const hostPorts = {
    // One transaction at a time, as row locks would order two writers of one capture.
    async transaction<T>(work: (tx: unknown) => Promise<T>): Promise<T> {
      await gate();
      const run = (order[order.length - 1] ?? Promise.resolve()).then(async () => {
        const before = { booked: new Map(booked), sold: sold.length };
        try {
          return await made.captures.transaction(() => work('host-tx'));
        } catch (error) {
          booked.clear();
          before.booked.forEach((target, code) => booked.set(code, target));
          sold.splice(before.sold);
          throw error;
        }
      });
      order.push(run.catch(() => undefined));
      return run;
    },
    mayBook: vi.fn(async () => live.policy),
    openSession: vi.fn(async () => {
      await options.meanwhile?.(made);
      return live.session;
    }),
    isRetryable: (error: unknown) => error === options.saleRacesOnce,
    bookedFor: async (_clientId: string, code: string, tx?: unknown): Promise<BindTarget | null> => (options.blindKey === true && tx !== undefined ? null : (booked.get(code) ?? null)),
    createSale: vi.fn(async (_tx: unknown, sale: StandaloneSale<SessionRow>) => {
      if (options.saleFails !== undefined) throw options.saleFails;
      const race = options.saleRacesOnce;
      if (race !== undefined && !raced.has(race)) {
        raced.add(race);
        throw race;
      }
      const target = made.sale(sale.clientId);
      sold.push(sale);
      booked.set(sale.capture.transactionCode, target);
      return target;
    }),
  };
  const claims = createTypedCaptureClaims({ ledger: made.ledger });

  /** One decision: the claim, then the caller's policy and session, then its sale and the bind in one transaction. */
  async function once(input: TypedCaptureInput): Promise<TypedBookAnswer | { lost: unknown }> {
    const claim = await claims.claimable(input);
    if (claim.claim !== 'FREE') return heldAnswer(claim, await hostPorts.bookedFor(input.clientId, input.capture.transactionCode));
    const policy = await hostPorts.mayBook();
    if (!policy.ok) return { outcome: 'NOT_ALLOWED', reason: policy.reason, ack: false };
    const session = await hostPorts.openSession();
    if (session === null) return { outcome: 'WAITING', ack: false };
    try {
      return await hostPorts.transaction(async (tx): Promise<TypedBookAnswer> => {
        const prior = await hostPorts.bookedFor(input.clientId, claim.capture.transactionCode, tx);
        if (prior !== null) return { outcome: 'BOOKED', ...prior, created: false, ack: true };
        const target = await hostPorts.createSale(tx, { clientId: claim.clientId, deviceId: claim.deviceId, session, capture: claim.capture });
        return claims.bind(tx, claim, target);
      });
    } catch (lost) {
      if (!(lost instanceof CaptureError) && !hostPorts.isRetryable(lost)) throw lost;
      return { lost };
    }
  }

  const booking = {
    async book(input: TypedCaptureInput): Promise<TypedBookAnswer> {
      let last: unknown = null;
      for (let attempt = 0; attempt < BOOK_ATTEMPTS; attempt += 1) {
        const answer = await once(input);
        if (!('lost' in answer)) return answer;
        last = answer.lost;
      }
      const refused = typedRefusalOf(last);
      if (refused !== null) return heldAnswer(refused, null);
      throw last;
    },
  };

  return {
    ports: hostPorts,
    booked,
    sold,
    claims,
    /** A session opens at the station. */
    openSession: (session: SessionRow) => void (live.session = session),
    booking,
  };
}

function setUp(options: HostOptions = {}) {
  const made = world();
  const deviceId = made.device();
  return { w: made, deviceId, ...host(made, options) };
}

describe('booking a typed capture', () => {
  it('D9-R09: books an unclaimed capture once, sold by its terminal, and says it may be acknowledged', async () => {
    const { w, deviceId, booking, sold } = setUp();
    const answer = await booking.book({ clientId: TENANT, deviceId, capture: wire() });

    expect(answer).toMatchObject({ outcome: 'BOOKED', created: true, ack: true });
    expect(sold).toHaveLength(1);
    expect(w.row('TC-0001')).toMatchObject({ state: 'BOUND', source: 'STATION', deviceId });
    if (answer.outcome === 'BOOKED') expect(w.row('TC-0001').orderId).toBe(answer.orderId);
  });

  it('D9-R18: hands the host the capturing terminal, the open session and the recorded capture', async () => {
    const { deviceId, booking, ports } = setUp();
    await booking.book({ clientId: TENANT, deviceId, capture: wire({ amountCents: 4600 }) });

    expect(ports.createSale).toHaveBeenCalledWith(
      'host-tx',
      expect.objectContaining({ clientId: TENANT, deviceId, session: { id: 'session-1' }, capture: expect.objectContaining({ transactionCode: 'TC-0001', amountCents: 4600 }) }),
    );
  });
});

describe('exactly once (A3)', () => {
  it('D9-R12: a repeat answers the first booking: the same sale, created false, nothing written again', async () => {
    const { deviceId, booking, sold } = setUp();
    const first = await booking.book({ clientId: TENANT, deviceId, capture: wire() });
    const again = await booking.book({ clientId: TENANT, deviceId, capture: wire() });

    expect(again).toEqual({ ...first, created: false });
    expect(sold).toHaveLength(1);
  });

  it('D9-R13: two pages at once book one sale, and both answer it', async () => {
    const { deviceId, booking, sold } = setUp({ barrier: 2 });
    const answers = await Promise.all([
      booking.book({ clientId: TENANT, deviceId, capture: wire() }),
      booking.book({ clientId: TENANT, deviceId, capture: wire() }),
    ]);

    expect(sold).toHaveLength(1);
    expect(answers.map((answer) => answer.outcome)).toEqual(['BOOKED', 'BOOKED']);
    expect(answers.filter((answer) => answer.outcome === 'BOOKED' && answer.created)).toHaveLength(1);
    expect(new Set(answers.map((answer) => (answer.outcome === 'BOOKED' ? answer.orderId : null))).size).toBe(1);
  });

  it('D9-R13: when the host key misses the race, the bind refuses the second sale and its transaction rolls back', async () => {
    const { w, deviceId, booking, sold, ports } = setUp({ blindKey: true, barrier: 2 });
    const answers = await Promise.all([
      booking.book({ clientId: TENANT, deviceId, capture: wire() }),
      booking.book({ clientId: TENANT, deviceId, capture: wire() }),
    ]);

    expect(ports.createSale).toHaveBeenCalledTimes(2);
    expect(sold).toHaveLength(1);
    const orders = answers.map((answer) => (answer.outcome === 'BOOKED' ? answer.orderId : answer.outcome));
    expect(orders[0]).toBe(orders[1]);
    expect(w.row('TC-0001').orderId).toBe(orders[0]);
  });

  it('D9-R14: a capture a recovery bound first is acknowledged and never booked', async () => {
    const { w, deviceId, booking, sold } = setUp();
    await w.ledger.record(capture({ deviceId, source: 'DEVICE' }));
    const recovered = w.sale();
    await w.ledger.bind(undefined, TENANT, ['TC-0001'], recovered);

    const answer = await booking.book({ clientId: TENANT, deviceId, capture: wire() });

    expect(answer).toEqual({ outcome: 'BOUND', orderId: recovered.orderId, ack: true });
    expect(sold).toHaveLength(0);
  });

  it('D9-R15: a capture marked created for another sale is acknowledged and never booked', async () => {
    const { w, deviceId, booking, sold } = setUp();
    await w.ledger.record(capture({ deviceId, source: 'DEVICE' }));
    const other = w.sale();
    await w.ledger.markSaleCreated(undefined, { clientId: TENANT, transactionCode: 'TC-0001' }, other.orderId);

    const answer = await booking.book({ clientId: TENANT, deviceId, capture: wire() });

    expect(answer).toEqual({ outcome: 'BOUND', orderId: other.orderId, ack: true });
    expect(sold).toHaveLength(0);
  });
});

describe('a move that lands while the booking decides', () => {
  it('D9-R14: a recovery binds it between the read and the transaction: BOUND, the sale rolled back', async () => {
    const recovered = { target: { orderId: '', paymentId: '' } };
    const { w, deviceId, booking, sold } = setUp({
      meanwhile: async (there) => {
        recovered.target = there.sale();
        await there.ledger.bind(undefined, TENANT, ['TC-0001'], recovered.target);
      },
    });
    const answer = await booking.book({ clientId: TENANT, deviceId, capture: wire() });

    expect(answer).toEqual({ outcome: 'BOUND', orderId: recovered.target.orderId, ack: true });
    expect(sold).toHaveLength(0);
    expect(w.row('TC-0001').orderId).toBe(recovered.target.orderId);
  });

  it('D9-R21: a refund flag lands between the read and the bind: FLAGGED, the sale rolled back', async () => {
    const { deviceId, booking, sold } = setUp({
      meanwhile: (there) => there.ledger.flag({ clientId: TENANT, transactionCode: 'TC-0001' }, 'RECEIVED_TWICE').then(() => undefined),
    });

    expect(await booking.book({ clientId: TENANT, deviceId, capture: wire() })).toEqual({ outcome: 'FLAGGED', ack: true });
    expect(sold).toHaveLength(0);
  });
});

describe('what keeps a capture waiting', () => {
  it('D9-R11: no open session: nothing is written, no acknowledgement, and it books once a session opens', async () => {
    const { w, deviceId, booking, sold, openSession } = setUp({ session: null });
    const waiting = await booking.book({ clientId: TENANT, deviceId, capture: wire() });

    expect(waiting).toEqual({ outcome: 'WAITING', ack: false });
    expect(sold).toHaveLength(0);
    expect(w.row('TC-0001').state).toBe('UNBOUND');

    openSession({ id: 'session-2' });
    const booked = await booking.book({ clientId: TENANT, deviceId, capture: wire() });
    expect(booked).toMatchObject({ outcome: 'BOOKED', created: true });
    expect(sold[0]?.session).toEqual({ id: 'session-2' });
  });

  it("D9-R23: the host's policy refuses: not booked, not acknowledged, its reason carried", async () => {
    const { w, deviceId, booking, sold, ports } = setUp({ policy: { ok: false, reason: 'PRODUCT_INVALID' } });
    const answer = await booking.book({ clientId: TENANT, deviceId, capture: wire() });

    expect(answer).toEqual({ outcome: 'NOT_ALLOWED', reason: 'PRODUCT_INVALID', ack: false });
    expect(sold).toHaveLength(0);
    expect(ports.openSession).not.toHaveBeenCalled();
    expect(w.row('TC-0001').state).toBe('UNBOUND');
  });

  it('D9-R23: a capture bound elsewhere is acknowledged even while the policy refuses', async () => {
    const { w, deviceId, booking } = setUp({ policy: { ok: false, reason: 'OFF' } });
    await w.ledger.record(capture({ deviceId, source: 'DEVICE' }));
    const sale = w.sale();
    await w.ledger.bind(undefined, TENANT, ['TC-0001'], sale);

    expect(await booking.book({ clientId: TENANT, deviceId, capture: wire() })).toEqual({ outcome: 'BOUND', orderId: sale.orderId, ack: true });
  });
});

describe('what refuses it', () => {
  it('D9-R18: the terminal that reported the capture is the seller; a page naming another terminal is refused', async () => {
    const { w, deviceId, booking, sold } = setUp();
    const other = w.device();
    await w.ledger.record(capture({ deviceId, source: 'DEVICE' }));

    expect(await booking.book({ clientId: TENANT, deviceId: other, capture: wire() })).toEqual({ outcome: 'REFUSED', code: 'DEVICE_MISMATCH', ack: false });
    expect(sold).toHaveLength(0);
    expect(w.row('TC-0001')).toMatchObject({ deviceId, state: 'UNBOUND' });
  });

  it('D9-R19: no terminal named is refused, and nothing is recorded', async () => {
    const { w, booking, sold } = setUp();
    expect(await booking.book({ clientId: TENANT, deviceId: ' ', capture: wire() })).toEqual({ outcome: 'REFUSED', code: 'DEVICE_MISMATCH', ack: false });
    expect(sold).toHaveLength(0);
    expect(w.rows()).toHaveLength(0);
  });

  it("D9-R19: a terminal of another tenant is refused and nothing is written", async () => {
    const { w, booking, sold } = setUp();
    const foreign = w.device(OTHER_TENANT);
    const answer = await booking.book({ clientId: TENANT, deviceId: foreign, capture: wire() });

    expect(answer).toEqual({ outcome: 'REFUSED', code: 'DEVICE_MISMATCH', ack: false });
    expect(sold).toHaveLength(0);
    expect(w.rows()).toHaveLength(0);
  });

  it("D9-R20: the terminal's own report disagrees: CONFLICT, not acknowledged, the stored row untouched", async () => {
    const { w, deviceId, booking, sold } = setUp();
    await w.ledger.record(capture({ deviceId, source: 'DEVICE', amountCents: 2500 }));
    const answer = await booking.book({ clientId: TENANT, deviceId, capture: wire({ amountCents: 3000 }) });

    expect(answer).toEqual({ outcome: 'REFUSED', code: 'CONFLICT', ack: false });
    expect(sold).toHaveLength(0);
    expect(w.row('TC-0001')).toMatchObject({ amountCents: 2500, state: 'UNBOUND' });
  });

  it('D9-R21: money already owed back is acknowledged and never booked', async () => {
    const { w, deviceId, booking, sold } = setUp();
    await w.ledger.record(capture({ deviceId, source: 'DEVICE' }));
    await w.ledger.flag({ clientId: TENANT, transactionCode: 'TC-0001' }, 'RECEIVED_TWICE');

    expect(await booking.book({ clientId: TENANT, deviceId, capture: wire() })).toEqual({ outcome: 'FLAGGED', ack: true });
    expect(sold).toHaveLength(0);
  });

  it('D9-R22: a capture flagged only for the timeout is booked, and the bind clears the flag', async () => {
    const { w, deviceId, booking } = setUp();
    await w.ledger.record(capture({ deviceId, source: 'DEVICE' }));
    await w.ledger.flag({ clientId: TENANT, transactionCode: 'TC-0001' }, 'UNBOUND_TIMEOUT');

    expect(await booking.book({ clientId: TENANT, deviceId, capture: wire() })).toMatchObject({ outcome: 'BOOKED', created: true });
    expect(w.row('TC-0001').refundClearedAt).not.toBeNull();
  });

  it('D9-R13: a host error inside the transaction that is not a race is thrown at once, never decided again', async () => {
    const { deviceId, booking, sold, ports } = setUp({ saleFails: new Error('disk full') });

    await expect(booking.book({ clientId: TENANT, deviceId, capture: wire() })).rejects.toThrow('disk full');
    expect(ports.createSale).toHaveBeenCalledTimes(1);
    expect(sold).toHaveLength(0);
  });

  it("D9-R13: an error the host calls a race (its unique key) is decided again, and books once", async () => {
    const { deviceId, booking, sold, ports } = setUp({ saleRacesOnce: new Error('unique violation') });
    const answer = await booking.book({ clientId: TENANT, deviceId, capture: wire() });

    expect(answer).toMatchObject({ outcome: 'BOOKED', created: true });
    expect(ports.createSale).toHaveBeenCalledTimes(2);
    expect(sold).toHaveLength(1);
  });
});

describe('caller-driven: the claims decide payment state only', () => {
  it('claimable records the capture and answers FREE with the seller; nothing of the caller is written', async () => {
    const { w, deviceId, claims, sold } = setUp();

    const claim = await claims.claimable({ clientId: TENANT, deviceId, capture: wire() });

    expect(claim).toMatchObject({ claim: 'FREE', clientId: TENANT, deviceId, capture: expect.objectContaining({ transactionCode: 'TC-0001', state: 'UNBOUND' }) });
    expect(w.row('TC-0001').state).toBe('UNBOUND');
    expect(sold).toHaveLength(0);
  });

  it("bind on a capture another sale took first throws the ledger's refusal, so the caller's transaction rolls its sale back", async () => {
    const { w, deviceId, claims } = setUp();
    const claim = await claims.claimable({ clientId: TENANT, deviceId, capture: wire() });
    if (claim.claim !== 'FREE') throw new Error('expected a free capture');
    const first = w.sale();
    await w.ledger.bind(undefined, TENANT, ['TC-0001'], first);

    await expect(claims.bind(undefined, claim, w.sale())).rejects.toBeInstanceOf(CaptureError);
    expect(w.row('TC-0001').orderId).toBe(first.orderId);
    expect(await claims.claimable({ clientId: TENANT, deviceId, capture: wire() })).toEqual({ claim: 'HELD', orderId: first.orderId, paymentId: first.paymentId });
  });

  it('heldAnswer: BOOKED created false only for the sale the caller booked for this code; BOUND otherwise', () => {
    const held = { claim: 'HELD' as const, orderId: 'order-1', paymentId: 'payment-1' };

    expect(heldAnswer(held, { orderId: 'order-1', paymentId: 'payment-1' })).toEqual({ outcome: 'BOOKED', orderId: 'order-1', paymentId: 'payment-1', created: false, ack: true });
    expect(heldAnswer(held, null)).toEqual({ outcome: 'BOUND', orderId: 'order-1', ack: true });
    expect(heldAnswer({ claim: 'FLAGGED' }, null)).toEqual({ outcome: 'FLAGGED', ack: true });
    expect(heldAnswer({ claim: 'REFUSED', code: 'CONTENDED' }, null)).toEqual({ outcome: 'REFUSED', code: 'CONTENDED', ack: false });
  });
});
