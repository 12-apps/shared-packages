import { describe, expect, it } from 'vitest';

import { ShiftConfigError, createMemoryShiftDb, createShiftService } from '../index';
import { defineShiftVocabulary } from '../vocabulary';

/**
 * The vocabulary seam itself.
 *
 * Everything here is about the moment a host STATES its kinds — the moment this
 * package used to skip, answering the question itself with two values it had no
 * business knowing.
 */
describe('a host declares the kinds', () => {
  it('admits exactly what was declared, and nothing else', () => {
    const vocabulary = defineShiftVocabulary(['climb', 'dispatch']);

    expect(vocabulary.kinds).toEqual(['climb', 'dispatch']);
    expect(vocabulary.has('climb')).toBe(true);
    expect(vocabulary.has('dispatch')).toBe(true);
    // The two values this package used to compile in are now as foreign as any
    // other word — which is the whole claim, stated as an assertion.
    expect(vocabulary.has('kitchen')).toBe(false);
    expect(vocabulary.has('service')).toBe(false);
  });

  it('keeps the declaration order, so a host can render its own list', () => {
    expect(defineShiftVocabulary(['gate', 'apron', 'tug']).kinds).toEqual(['gate', 'apron', 'tug']);
  });

  it('does not let one host declaration reach another', () => {
    // A module-scope set would serve the second host the first one's words.
    const farm = defineShiftVocabulary(['climb', 'dispatch']);
    const clinic = defineShiftVocabulary(['hygiene', 'surgery']);

    expect(farm.has('surgery')).toBe(false);
    expect(clinic.has('climb')).toBe(false);
  });

  it('is not mutable through the array the host passed', () => {
    const declared: string[] = ['climb'];
    const vocabulary = defineShiftVocabulary(declared as [string, ...string[]]);
    declared.push('trespass');

    expect(vocabulary.has('trespass')).toBe(false);
    expect(vocabulary.kinds).toEqual(['climb']);
  });
});

describe('a wiring mistake fails where it is written', () => {
  const reject = (kinds: readonly string[]) => () =>
    defineShiftVocabulary(kinds as unknown as [string, ...string[]]);

  it('refuses an empty declaration', () => {
    // A service with no admissible kind can open no shift at all. Heard here,
    // at assembly, rather than at the request where nobody can clock in.
    expect(reject([])).toThrow(ShiftConfigError);
  });

  it('refuses a blank kind', () => {
    expect(reject(['climb', '   '])).toThrow(/non-empty/);
  });

  it('refuses a duplicate, naming it', () => {
    expect(reject(['climb', 'dispatch', 'climb'])).toThrow(/Duplicate shift kind: climb/);
  });

  it('carries the same refusals through the service constructor', () => {
    expect(() =>
      createShiftService(createMemoryShiftDb(), {
        kinds: [] as unknown as [string, ...string[]],
      }),
    ).toThrow(ShiftConfigError);
  });
});

describe('the service validates against the declaration it was given', () => {
  const open = (kinds: [string, ...string[]], kind: string) =>
    createShiftService(createMemoryShiftDb(), { kinds }).openShift({
      clientId: 'tenant-a',
      userId: 'worker-1',
      kind,
      actorUserId: 'worker-1',
    });

  it('opens a kind this package has never heard of', async () => {
    await expect(open(['hygiene', 'surgery'], 'hygiene')).resolves.toMatchObject({
      kind: 'hygiene',
    });
  });

  it('refuses a kind the host did not declare, and says what it would take', async () => {
    await expect(open(['hygiene', 'surgery'], 'climb')).rejects.toMatchObject({
      code: 'INVALID_SHIFT',
      message: 'Unknown shift kind: climb. Declared kinds: hygiene, surgery.',
    });
  });

  it('refuses the kinds this package used to accept unconditionally', async () => {
    // The regression test for the removal. Before it, these two opened against
    // ANY host, because the check was two literals rather than a question about
    // the host's own declaration.
    await expect(open(['hygiene', 'surgery'], 'kitchen')).rejects.toMatchObject({
      code: 'INVALID_SHIFT',
    });
    await expect(open(['hygiene', 'surgery'], 'service')).rejects.toMatchObject({
      code: 'INVALID_SHIFT',
    });
  });
});
