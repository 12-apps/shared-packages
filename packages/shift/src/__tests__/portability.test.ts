/* eslint-disable test-flakiness/no-test-isolation --
   both findings are the heuristic reading a per-case local and a frozen
   constant as shared state. `db` is destructured from `clinic()`, which builds
   a NEW in-memory store inside the case that uses it, and `OPENED_AT` is an
   immutable `Date` literal read for arithmetic — the mutable clock beside it is
   a container property, rebuilt per case, which is the shape this rule asks
   for. */
/**
 * A REAL SECOND HOST — the acceptance gate for portability.
 *
 * A portability claim is worth exactly what it is tested against, and testing
 * it against the application the package came out of proves nothing: that
 * application's vocabulary is the one that used to be compiled in. So the host
 * below is a DENTAL CLINIC — hygiene, surgery and reception shifts, with the
 * operatory chairs claimed exclusively because two clinicians may not work one
 * chair at once. It shares no word with the origin.
 *
 * That example is not arbitrary. The leak this suite exists to hold shut was
 * `kind`: two values from one restaurant's staff structure, exported as a
 * runtime list, a type union and a database CHECK constraint, so a clinic
 * adopting this package got them in its own generated types and its own wire
 * contract. Nothing failed. Every test passed. The suite simply had no host
 * that would have noticed — which is what a portability suite is for, and why
 * `copy-portability-gate.mjs` says in its own header that vocabulary is judged
 * here rather than by a language sweep.
 *
 * If this file compiles and passes, the service presumes no product.
 */
import { describe, expect, it } from 'vitest';

import {
  ShiftConfigError,
  createMemoryShiftDb,
  createShiftService,
  defineShiftVocabulary,
  type MemoryShiftDb,
  type ShiftService,
} from '../index';

import { foreignPatterns, HOST1, HOST2 } from './foreign-vocabulary';

/** The clinic's own words. Nothing below is supplied by this package. */
const CLINIC = 'clinic-riverside';
const CLINIC_KINDS = ['hygiene', 'surgery', 'reception'] as const;
const CHAIR = 'operatory-chair';
const HYGIENIST = 'hygienist-mensah';
const DENTIST = 'dds-okonkwo';

/** A completely unrelated third host, for the two-hosts-in-one-process cases. */
const FERRY = 'ferry-north';
const FERRY_KINDS = ['deck', 'engine-room'] as const;
const MATE = 'mate-thorsen';

const OPENED_AT = new Date('2026-08-21T08:00:00.000Z');
const HOUR_MS = 60 * 60_000;

type ClinicKind = (typeof CLINIC_KINDS)[number];

/** Everything the clinic has to write to adopt the package. */
function clinic(now: () => Date = () => OPENED_AT): {
  db: MemoryShiftDb;
  service: ShiftService<ClinicKind>;
} {
  const db = createMemoryShiftDb();
  const ids = { sequence: 0 };
  return {
    db,
    service: createShiftService(db, {
      kinds: CLINIC_KINDS,
      now,
      createId: () => `clinic-${++ids.sequence}`,
    }),
  };
}

describe('a host that is not the one this package came from — opening', () => {
  it('opens a shift in each kind the clinic declared', async () => {
    const { service } = clinic();

    for (const kind of CLINIC_KINDS) {
      const shift = await service.openShift({
        clientId: CLINIC,
        userId: `${kind}-worker`,
        kind,
        actorUserId: `${kind}-worker`,
      });
      expect(shift).toMatchObject({ clientId: CLINIC, kind, endedAt: null });
    }
  });

  it('refuses a kind the clinic did not declare', async () => {
    // Including — especially — the two the package used to accept from anyone.
    const { service } = clinic();

    for (const foreign of ['kitchen', 'service', 'grooming']) {
      await expect(
        service.openShift({
          clientId: CLINIC,
          userId: HYGIENIST,
          kind: foreign as ClinicKind,
          actorUserId: HYGIENIST,
        }),
      ).rejects.toMatchObject({ code: 'INVALID_SHIFT' });
    }
    expect(clinic().db.snapshot().shifts).toEqual([]);
  });

  it('claims a chair exclusively, in the clinic own resource type', async () => {
    const { service } = clinic();
    const chair = { type: CHAIR, id: 'chair-3', exclusive: true };

    const first = await service.openShift({
      clientId: CLINIC,
      userId: HYGIENIST,
      kind: 'hygiene',
      actorUserId: HYGIENIST,
      resource: chair,
    });

    expect(first).toMatchObject({ resourceType: CHAIR, resourceId: 'chair-3' });
    await expect(
      service.openShift({
        clientId: CLINIC,
        userId: DENTIST,
        kind: 'surgery',
        actorUserId: DENTIST,
        resource: chair,
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_TAKEN' });
  });

  it('writes the clinic audit trail through the host port, with no package words in it', async () => {
    const { db, service } = clinic();

    await service.openShift({
      clientId: CLINIC,
      userId: DENTIST,
      kind: 'surgery',
      actorUserId: DENTIST,
      resource: { type: CHAIR, id: 'chair-1' },
    });

    expect(db.snapshot().audits[0]).toMatchObject({
      clientId: CLINIC,
      actorUserId: DENTIST,
      action: 'shift.start',
      after: { kind: 'surgery', resourceType: CHAIR, resourceId: 'chair-1' },
    });
  });
});

describe('a host that is not the one this package came from — the rest of the seam', () => {
  it('filters the clinic history by the clinic kinds', async () => {
    const { service } = clinic();
    await service.openShift({
      clientId: CLINIC,
      userId: HYGIENIST,
      kind: 'hygiene',
      actorUserId: HYGIENIST,
    });
    await service.openShift({
      clientId: CLINIC,
      userId: DENTIST,
      kind: 'surgery',
      actorUserId: DENTIST,
    });

    const open = await service.listOpenShifts({ clientId: CLINIC, kind: 'surgery' });
    const page = await service.listShifts({ clientId: CLINIC, kind: 'hygiene' });

    expect(open.map((shift) => shift.userId)).toEqual([DENTIST]);
    expect(page.items.map((shift) => shift.userId)).toEqual([HYGIENIST]);
  });

  it('sweeps on the clinic own per-tenant window', async () => {
    const clock = { at: OPENED_AT };
    const { service } = clinic(() => clock.at);
    await service.openShift({
      clientId: CLINIC,
      userId: HYGIENIST,
      kind: 'hygiene',
      actorUserId: HYGIENIST,
    });
    clock.at = new Date(OPENED_AT.getTime() + 9 * HOUR_MS);

    const result = await service.autoCloseOverdue({
      // A clinic day, not a restaurant one — the number is the host's.
      maxDurationMsForTenant: () => Promise.resolve(8 * HOUR_MS),
    });

    expect(result.failures).toEqual([]);
    expect(result.closed).toHaveLength(1);
    expect(result.closed[0]).toMatchObject({ endedReason: 'auto', userId: HYGIENIST });
  });

  it('lets the clinic narrow a stored string back to its own union', async () => {
    // The read side is `string`, because a row is whatever the column holds.
    // A host that wants its union back gets it from the same declaration the
    // service validates against — one source, so the two cannot drift.
    const vocabulary = defineShiftVocabulary(CLINIC_KINDS);
    const { service } = clinic();
    const stored = await service.openShift({
      clientId: CLINIC,
      userId: DENTIST,
      kind: 'surgery',
      actorUserId: DENTIST,
    });

    const narrowed: ClinicKind | null = vocabulary.has(stored.kind) ? stored.kind : null;

    expect(narrowed).toBe('surgery');
    expect(vocabulary.has('kitchen')).toBe(false);
  });
});

describe('two hosts in one process', () => {
  it('do not see each other kinds', () => {
    // A package that quietly kept module-scope state would serve the first host
    // correctly and the second one somebody else's words.
    const clinicVocabulary = defineShiftVocabulary(CLINIC_KINDS);
    const ferry = defineShiftVocabulary(FERRY_KINDS);

    expect(clinicVocabulary.has('deck')).toBe(false);
    expect(ferry.has('surgery')).toBe(false);
  });

  it('validate independently, through their own services', async () => {
    const db = createMemoryShiftDb();
    const ferry = createShiftService(db, { kinds: FERRY_KINDS, now: () => OPENED_AT });
    const { service } = clinic();

    await expect(
      ferry.openShift({
        clientId: FERRY,
        userId: MATE,
        kind: 'surgery' as (typeof FERRY_KINDS)[number],
        actorUserId: MATE,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_SHIFT' });
    await expect(
      service.openShift({
        clientId: CLINIC,
        userId: DENTIST,
        kind: 'deck' as ClinicKind,
        actorUserId: DENTIST,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_SHIFT' });
  });

  it('refuse the same assembly mistakes, independently', () => {
    expect(() => defineShiftVocabulary(['deck', 'deck'])).toThrow(ShiftConfigError);
    expect(() => defineShiftVocabulary(['hygiene', 'hygiene'])).toThrow(ShiftConfigError);
  });
});

describe('the fixtures themselves', () => {
  /**
   * The anti-vacuity guard for the SUITE above: a portability proof written in
   * the extraction origin's own words proves nothing, and would look identical
   * to this file.
   *
   * It checks against `foreignPatterns()` — IMPORTED, not restated. A sibling
   * package's revision wrote its own regex covering eight of the sweep's
   * entries while claiming in a comment to use "the same one", which is two
   * statements of a set that can drift.
   */
  it('share no word with the application this package was extracted from', () => {
    const fixtureWords = [
      ...CLINIC_KINDS,
      ...FERRY_KINDS,
      CLINIC,
      CHAIR,
      HYGIENIST,
      DENTIST,
      FERRY,
      MATE,
      'chair-3',
      'operatory',
    ];

    const bans = foreignPatterns();
    for (const word of fixtureWords) {
      expect(bans.filter(({ pattern }) => new RegExp(pattern.source, 'i').test(word))).toEqual([]);
    }

    // Anti-vacuity for the guard itself: a loop over an empty list passes.
    expect(fixtureWords.length).toBeGreaterThan(10);
    // …and the list it checks against is the real one, with the entries a
    // hand-written copy would have dropped.
    expect(bans.map(({ label }) => label)).toEqual(
      expect.arrayContaining(['kitchen', 'sector', 'comanda', `${HOST1}-${HOST2}`, 'FUT-<n>']),
    );
    expect(bans.some(({ pattern }) => new RegExp(pattern.source, 'i').test('a kitchen shift'))).toBe(
      true,
    );
  });
});
