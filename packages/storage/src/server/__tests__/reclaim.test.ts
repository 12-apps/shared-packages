import { describe, expect, it } from 'vitest';

import { DEFAULT_MAX_UPLOAD_BYTES } from '../../limits';
import { CATALOG_RENDITIONS } from '../../renditions';
import { createApiStorage, type ApiStorage } from '../create-api-storage';
import type { StorageReferenceProbe } from '../reclaim';
import { fakePipeline, memoryDriver, recordingLogger, type MemoryDriver } from './fixtures';

/**
 * Reclaiming a REPLACED object.
 *
 * Two properties are the package's and the rest is the host's: the WHOLE SET goes
 * (deleting one key would leak five crops per replaced photo — the same leak, one
 * level down), and a key outside the caller's SCOPE is never touched whatever the
 * probes say. The probes themselves are host tables, so they arrive as predicates.
 */

const SCOPE = 'minha-loja';
const UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const KEY = `products/${SCOPE}/${UUID}/full.webp`;
const FLAT = `products/${SCOPE}/${UUID}.webp`;
const LEGACY = `products/${UUID}/full.webp`;
const FOREIGN = `products/outra-loja/${UUID}/full.webp`;

function probe(name: string, answer: boolean): StorageReferenceProbe {
  return { name, referenced: async () => answer };
}

interface Harness {
  api: ApiStorage;
  driver: MemoryDriver;
  logs: string[];
}

function harness(
  options: {
    probes?: readonly StorageReferenceProbe[];
    unscopedKeys?: 'accept' | 'reject';
  } = {},
): Harness {
  // Named distinctly from what the cases destructure: a `const` holding a call
  // result inside a module-level helper reads as shared state to the flakiness gate.
  const memory = memoryDriver();
  const sink = recordingLogger();
  const mounted = createApiStorage({
    driver: memory,
    maxBytes: DEFAULT_MAX_UPLOAD_BYTES,
    imagePipeline: fakePipeline(),
    unscopedKeys: options.unscopedKeys ?? 'accept',
    // Written out and not omitted: `references` is required, and `[]` is a decision
    // ("nothing in this host copies a key") rather than the absence of one.
    references: options.probes ?? [],
    logger: sink,
  });
  return { api: mounted, driver: memory, logs: sink.lines };
}

/** One crop of {@link KEY}'s set, named without calling a method on a constant. */
function cropOf(name: string): string {
  return KEY.replace('full.webp', `${name}.webp`);
}

describe('deleteIfOrphaned', () => {
  it('deletes an object nothing references any more', async () => {
    const { api, driver } = harness();

    await api.reclaim.deleteIfOrphaned(SCOPE, FLAT);

    expect(driver.deleted).toEqual([FLAT]);
  });

  it('reclaims the whole crop SET, not just the object the row named', async () => {
    const { api, driver } = harness();

    await api.reclaim.deleteIfOrphaned(SCOPE, KEY);

    expect(driver.deleted.sort()).toEqual(
      [KEY, ...CATALOG_RENDITIONS.map((spec) => cropOf(spec.name))].sort(),
    );
  });

  it('keeps an object a probe still claims', async () => {
    const { api, driver } = harness({ probes: [probe('live-rows', true)] });

    await api.reclaim.deleteIfOrphaned(SCOPE, KEY);

    expect(driver.deleted).toEqual([]);
  });

  it('stops at the FIRST probe that claims it, and asks the others nothing', async () => {
    const asked: string[] = [];
    const watching = (name: string, answer: boolean): StorageReferenceProbe => ({
      name,
      referenced: async () => {
        asked.push(name);
        return answer;
      },
    });
    const { api } = harness({ probes: [watching('live', true), watching('drafts', false)] });

    await api.reclaim.deleteIfOrphaned(SCOPE, KEY);

    expect(asked).toEqual(['live']);
  });

  it("REFUSES another tenant's key, and says so", async () => {
    // A probe answers "does anything of MINE reference this?" — which is true of
    // every other tenant's objects too. That is exactly how a scope-blind reclaim
    // deletes a neighbour's photo.
    const { api, driver, logs } = harness();

    await api.reclaim.deleteIfOrphaned(SCOPE, FOREIGN);

    expect(driver.deleted).toEqual([]);
    expect(logs.join('\n')).toContain('does not belong to scope');
  });

  it('touches an UNSCOPED legacy key only when the host accepted them', async () => {
    const accepting = harness({ unscopedKeys: 'accept' });
    await accepting.api.reclaim.deleteIfOrphaned(SCOPE, LEGACY);
    expect(accepting.driver.deleted).toContain(LEGACY);

    const rejecting = harness({ unscopedKeys: 'reject' });
    await rejecting.api.reclaim.deleteIfOrphaned(SCOPE, LEGACY);
    expect(rejecting.driver.deleted).toEqual([]);
  });

  it('ignores a null key without touching storage', async () => {
    const { api, driver } = harness();

    await api.reclaim.deleteIfOrphaned(SCOPE, null);
    await api.reclaim.deleteIfOrphaned(SCOPE, undefined);

    expect(driver.deleted).toEqual([]);
  });

  it('ignores a key this scheme never minted, so nothing malformed reaches a probe', async () => {
    const asked: string[] = [];
    const { api, driver } = harness({
      probes: [
        {
          name: 'sql',
          referenced: async (_scope, key) => {
            asked.push(key);
            return false;
          },
        },
      ],
    });

    await api.reclaim.deleteIfOrphaned(SCOPE, "'; DROP TABLE products; --");

    expect(asked).toEqual([]);
    expect(driver.deleted).toEqual([]);
  });

  it('swallows a storage failure — the write it followed already succeeded', async () => {
    const { api, driver, logs } = harness();
    driver.failWith(new Error('bucket timed out'));

    await expect(api.reclaim.deleteIfOrphaned(SCOPE, FLAT)).resolves.toBeUndefined();
    expect(logs.join('\n')).toContain('bucket timed out');
  });

  it('swallows a PROBE failure rather than failing the write it followed', async () => {
    const { api, logs } = harness({
      probes: [
        {
          name: 'db',
          referenced: async () => {
            throw new Error('connection lost');
          },
        },
      ],
    });

    await expect(api.reclaim.deleteIfOrphaned(SCOPE, FLAT)).resolves.toBeUndefined();
    expect(logs.join('\n')).toContain('connection lost');
  });
});

describe('deleteReplaced', () => {
  it('deletes only the keys the write superseded', async () => {
    const { api, driver } = harness();
    const kept = `products/${SCOPE}/9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d.webp`;

    await api.reclaim.deleteReplaced(SCOPE, [FLAT, kept], [kept]);

    expect(driver.deleted).toEqual([FLAT]);
  });

  it('deletes nothing when the image did not change', async () => {
    const { api, driver } = harness();

    await api.reclaim.deleteReplaced(SCOPE, [FLAT], [FLAT]);

    expect(driver.deleted).toEqual([]);
  });

  it('deduplicates a key that appeared twice before the write', async () => {
    const { api, driver } = harness();

    await api.reclaim.deleteReplaced(SCOPE, [FLAT, FLAT, null], [null]);

    expect(driver.deleted).toEqual([FLAT]);
  });
});

describe('discardMinted', () => {
  it('purges without asking a probe — nothing can reference a key nobody has seen', async () => {
    const asked: string[] = [];
    const { api, driver } = harness({
      probes: [
        {
          name: 'live',
          referenced: async (_scope, key) => {
            asked.push(key);
            return true;
          },
        },
      ],
    });

    await api.reclaim.discardMinted(SCOPE, [FLAT]);

    expect(asked).toEqual([]);
    expect(driver.deleted).toEqual([FLAT]);
  });

  it('still refuses a key outside the scope', async () => {
    const { api, driver } = harness();

    await api.reclaim.discardMinted(SCOPE, [FOREIGN, null]);

    expect(driver.deleted).toEqual([]);
  });

  it('never throws, whatever the driver does', async () => {
    const { api, driver, logs } = harness();
    driver.failWith(new Error('gone'));

    await expect(api.reclaim.discardMinted(SCOPE, [FLAT])).resolves.toBeUndefined();
    expect(logs.join('\n')).toContain('could not discard');
  });
});

describe('objectKeysFor', () => {
  it('names the whole set for a set key, and just itself for a flat one', () => {
    const { api } = harness();

    expect(api.reclaim.objectKeysFor(KEY)).toHaveLength(CATALOG_RENDITIONS.length + 1);
    expect(api.reclaim.objectKeysFor(FLAT)).toEqual([FLAT]);
  });
});

describe('the probe→purge window is reported rather than silent', () => {
  /**
   * The reclaim is read-validate-write with no claim-once and no transaction, so a
   * request that ATTACHES the key between the last probe and the delete loses its
   * object. That window cannot be closed here — closing it needs refcounting in the
   * host's own tables — but it must not be INVISIBLE: "the reclaim deleted the image
   * I just attached" is otherwise a data-loss bug with no log line anywhere.
   */

  /** A probe that says "not referenced" first and "referenced" afterwards. */
  function attachesDuringPurge(): StorageReferenceProbe {
    // A container property, never a reassigned closed-over `let` — the pattern the
    // flakiness gate rejects.
    const state = { asked: 0 };
    return {
      name: 'duplicated-rows',
      referenced: async () => {
        state.asked += 1;
        return state.asked > 1;
      },
    };
  }

  it('logs the race, naming the probe that now claims the key', async () => {
    const { api, driver, logs } = harness({ probes: [attachesDuringPurge()] });

    await api.reclaim.deleteIfOrphaned(SCOPE, KEY);

    // The delete still happened — this is detection, not prevention, and claiming
    // otherwise would be worse than the window.
    expect(driver.deleted).toContain(KEY);
    expect(logs.join('\n')).toContain('duplicated-rows');
    expect(logs.join('\n')).toContain('no longer exist');
  });

  it('stays silent on the ordinary path, where nothing raced', async () => {
    const { api, driver, logs } = harness({ probes: [probe('live-rows', false)] });

    await api.reclaim.deleteIfOrphaned(SCOPE, KEY);

    expect(driver.deleted).toContain(KEY);
    expect(logs).toEqual([]);
  });

  it('asks nothing extra when the host declared no probes', async () => {
    // `references: []` has no window to detect, so it pays nothing for the check.
    const { api, driver, logs } = harness({ probes: [] });

    await api.reclaim.deleteIfOrphaned(SCOPE, KEY);

    expect(driver.deleted).toContain(KEY);
    expect(logs).toEqual([]);
  });

  it('does not run the check when a probe kept the object', async () => {
    const { api, driver, logs } = harness({ probes: [probe('pending', true)] });

    await api.reclaim.deleteIfOrphaned(SCOPE, KEY);

    expect(driver.deleted).toEqual([]);
    expect(logs).toEqual([]);
  });
});
