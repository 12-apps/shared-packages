import { hasRenditions, keyInScope, parseObjectKey, renditionKey } from '../keys';
import type { RenditionSpec } from '../renditions';
import type { StorageDriver } from './driver';

/**
 * Reclaiming the bytes behind a REPLACED object.
 *
 * When a photo is swapped, the superseded object used to stay in the bucket
 * forever — nothing referenced it, nothing served it, nothing removed it. Every
 * re-upload leaked one.
 *
 * WHY THIS IS NOT JUST `driver.delete(oldKey)`. A key can outlive the row that
 * pointed at it, and some of those states are ones a person is ABOUT TO ACT ON:
 * a duplicated row sharing one object, a soft-deleted row whose "restore" is
 * expected to bring the photo back, a draft or a pending approval holding a key
 * waiting to be published. Deleting the object would break the very next thing
 * they do.
 *
 * Which states those are is the HOST'S question, not this package's — they are
 * its tables. So they arrive as {@link StorageReferenceProbe}s: named predicates
 * the reclaim consults before deleting anything. The package supplies the two
 * things a host cannot get right by itself, and the reason this is not just a
 * `delete` call:
 *
 *   - the whole SET goes, not just the object the row named. Deleting one key
 *     would leak five crops per replaced photo — the same leak, one level down;
 *   - a key outside the caller's SCOPE is never touched, whatever the probes say.
 *     A probe answers "does anything of MINE reference this?", and that is true of
 *     every other tenant's objects too — which is exactly how a scope-blind
 *     reclaim deletes a neighbour's photo.
 *
 * Cleanup is best-effort BY CONSTRUCTION: it runs after the write it follows, and
 * a failure is logged rather than raised. A store owner who successfully changed a
 * photo must not see an error because a bucket delete timed out.
 */

/**
 * One reason an object might still be needed, as a predicate over the host's own
 * tables.
 *
 * `name` is not decoration: it is what the log line says when a reclaim is
 * declined, which is the difference between "the bucket is growing" and "drafts
 * are pinning objects".
 */
export interface StorageReferenceProbe {
  name: string;
  /** Does anything in this store still reference `key`, within `scope`? */
  referenced(scope: string, key: string): Promise<boolean>;
}

/** Where a reclaim's own failures go. */
export interface StorageLogger {
  error(message: string): void;
}

export interface ReclaimDeps {
  driver: StorageDriver;
  probes: readonly StorageReferenceProbe[];
  logger: StorageLogger;
  unscopedKeys: 'accept' | 'reject';
  specs: readonly RenditionSpec[];
  keyPrefix: string;
}

/**
 * Every object key a stored photo occupies: the key on the row plus the crops
 * beside it — just the key itself for a photo stored alone.
 *
 * Read off the KEY, the same way the writer wrote it, so a reclaim cannot need a
 * second record of what exists.
 */
export function objectKeysFor(
  key: string,
  specs: readonly RenditionSpec[],
  keyPrefix: string,
): string[] {
  if (!hasRenditions(key, keyPrefix)) return [key];
  return [
    key,
    ...specs
      .map((spec) => renditionKey(key, spec.name, keyPrefix))
      .filter((sibling): sibling is string => sibling !== null),
  ];
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Delete the object behind `key` if — and only if — nothing references it any
 * more. Safe to call with a key still in use, one that never existed, and `null`.
 *
 * Never throws: callers invoke it after a successful write and must not have
 * their response changed by its outcome.
 */
export async function deleteIfOrphaned(
  deps: ReclaimDeps,
  scope: string,
  key: string | null | undefined,
): Promise<void> {
  // A key this scheme did not mint is not ours to delete, and a malformed value
  // must never reach a probe's query at all.
  if (!key || !parseObjectKey(key, deps.keyPrefix)) return;
  if (!keyInScope(key, scope, deps.unscopedKeys, deps.keyPrefix)) {
    deps.logger.error(
      `[storage] refused to reclaim ${key}: it does not belong to scope ${scope}`,
    );
    return;
  }
  try {
    for (const probe of deps.probes) {
      if (await probe.referenced(scope, key)) return;
    }
    await purge(deps, key);
  } catch (error) {
    // The write this followed already succeeded. Logged through the host's own
    // logger so a bucket that starts refusing deletes is discoverable rather than
    // silently accumulating objects.
    deps.logger.error(`[storage] could not reclaim ${key}: ${errorText(error)}`);
  }
}

/** Delete every member of `key`'s set, unconditionally. */
async function purge(deps: ReclaimDeps, key: string): Promise<void> {
  await Promise.all(
    objectKeysFor(key, deps.specs, deps.keyPrefix).map((object) =>
      deps.driver.delete(object),
    ),
  );
}

/**
 * Reclaim every key a write SUPERSEDED: those present before and absent after.
 *
 * Order is irrelevant and each is independent, so they run together. A key that
 * appeared twice before the write is reclaimed once.
 */
export async function deleteReplaced(
  deps: ReclaimDeps,
  scope: string,
  before: readonly (string | null | undefined)[],
  after: readonly (string | null | undefined)[],
): Promise<void> {
  const kept = new Set(after.filter((key): key is string => typeof key === 'string'));
  const superseded = [
    ...new Set(
      before.filter((key): key is string => typeof key === 'string' && !kept.has(key)),
    ),
  ];
  await Promise.all(superseded.map((key) => deleteIfOrphaned(deps, scope, key)));
}

/**
 * Discard objects this request itself just minted — no probes consulted.
 *
 * For a write that fails AFTER storing its bytes (a spent quota, a duplicate
 * name): nothing can reference a key nobody has been told about yet, so asking
 * the host's tables about it would be a round trip whose answer is known. Still
 * scope-checked, and still silent about its own failures.
 */
export async function discardMinted(
  deps: ReclaimDeps,
  scope: string,
  keys: readonly (string | null | undefined)[],
): Promise<void> {
  const own = keys.filter(
    (key): key is string =>
      typeof key === 'string' && keyInScope(key, scope, deps.unscopedKeys, deps.keyPrefix),
  );
  await Promise.all(
    own.map(async (key) => {
      try {
        await purge(deps, key);
      } catch (error) {
        deps.logger.error(`[storage] could not discard ${key}: ${errorText(error)}`);
      }
    }),
  );
}
