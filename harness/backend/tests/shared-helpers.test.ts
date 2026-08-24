/**
 * `@12-apps/shared-helpers` from a CONSUMER.
 *
 * This package had exactly one mention anywhere in either harness —
 * `published-subpaths.test.ts`, which checks that the FILE a subpath points at
 * exists. That gate is deliberately shallow and says so; it is about the
 * `exports` map agreeing with the tarball's contents, not about anything
 * running.
 *
 * Which left the package in the position the harness exists to make
 * impossible: everything it ships is reachable on paper, and nothing has ever
 * imported it.
 *
 * ## The wildcard is the reason this matters more here than elsewhere
 *
 * `@12-apps/shared-helpers` is the one package whose `exports` is a WILDCARD —
 * every subpath resolves through `./dist/<name>/index.js` — so its subpath
 * list is whatever the build happened to emit. Every other package names its
 * entries one by one, and a subpath that stopped being built is a missing key a
 * diff shows. Here it is a directory that silently is not there, and the only
 * thing that can tell the difference is an import.
 *
 * ## And it is a BUILT package, unlike most of the estate
 *
 * Twenty of these packages point `exports` at `./src` and ship no `dist` at
 * all, which is deliberate — their consumers bundle. This one compiles, so
 * there is a build step between the source its own suite tests and the files a
 * consumer loads. That gap has no other observer.
 */
import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

import { formatBRL, fromCents, parseBRL, toCents } from '@12-apps/shared-helpers/money';
import { mapWithConcurrency, withRetry } from '@12-apps/shared-helpers/requests';

/**
 * A CommonJS `require` rooted at this file.
 *
 * Built per call rather than once at module scope: the flakiness gate refuses a
 * module-level binding a test can reach, and it is a cheap call — `createRequire`
 * hands back a function over the resolver, not a new module registry.
 */
function nodeRequire(): NodeJS.Require {
  return createRequire(import.meta.url);
}

describe('the wildcard subpaths, imported rather than stat-ed', () => {
  it('resolves the entries a consumer actually reaches for', () => {
    // Named one by one on purpose. The wildcard means nothing here is declared,
    // so a directory the build stopped emitting disappears from the surface
    // with no key removed from any manifest — and the file-level gate beside
    // this one cannot see the difference between "not built" and "not asked
    // for".
    const resolve = nodeRequire().resolve;
    for (const subpath of ['money', 'requests', 'utils', 'cache', 'db']) {
      expect(() => resolve(`@12-apps/shared-helpers/${subpath}`)).not.toThrow();
    }
  });

  it('answers a subpath that was never built with a resolution failure', () => {
    // The guard on the guard: a wildcard that matched EVERYTHING would make the
    // case above pass for a package that shipped nothing at all.
    expect(() => nodeRequire().resolve('@12-apps/shared-helpers/not-a-module')).toThrow();
  });
});

describe('the money entry is CLIENT-SAFE, which is its whole reason to exist', () => {
  it('does not pull the Node-only utils barrel in behind it', () => {
    // The package's own docblock states the contract: `./money` re-exports the
    // pure BRL helpers so a client component can format currency "without
    // pulling the `@12-apps/shared-helpers/utils` barrel, which `export *`s
    // Node-only modules (jwt, logger, getGeoLocation, …)".
    //
    // That claim is about the BUILT module's imports, and it is invisible to
    // the package's own suite: in a Node test runner, importing the whole utils
    // barrel works perfectly. The symptom only appears in a browser bundle, at
    // a consumer, as `jsonwebtoken` being dragged into a storefront.
    // The real module GRAPH, not the file's text. Two reasons it has to be the
    // graph: the built file NAMES the Node-only modules in the docblock
    // explaining why it avoids them, so a substring search would fail on the
    // very comment stating the contract — and a regex over `require(...)` calls
    // reads only the first hop, while what reaches a browser bundle is the
    // whole closure. `require.cache` is what the loader actually walked.
    const nodeRequire_ = nodeRequire();
    const entry = nodeRequire_.resolve('@12-apps/shared-helpers/money');
    nodeRequire_(entry);

    const pulled = (nodeRequire_.cache[entry]?.children ?? []).map((child) =>
      child.filename.slice(child.filename.indexOf('shared-helpers/') + 'shared-helpers/'.length),
    );

    // It reaches the leaf, and ONLY the leaf.
    expect(pulled).toEqual(['dist/utils/lib/money.js']);
  });

  it('round-trips an amount through cents without float drift', () => {
    // Integer cents is the invariant the module is built on; `19.9 * 100` is
    // 1989.9999999999998 in IEEE-754 and rounding is what makes it 1990.
    expect(toCents(19.9)).toBe(1990);
    expect(fromCents(1990)).toBe(19.9);
    expect(parseBRL(formatBRL(1990))).toBe(1990);
  });

  it('emits an ASCII space, not the one Intl actually produces', () => {
    // `Intl.NumberFormat('pt-BR', BRL)` puts U+00A0 between `R$` and the
    // number, and which one it emits has moved between Node ICU versions. The
    // helper normalizes it, and this is the assertion that would fail if the
    // normalization were dropped — a consumer comparing `'R$ 19,90'` against an
    // un-normalized result gets a mismatch it cannot see in a terminal.
    expect(formatBRL(1990)).toBe('R$ 19,90');
    expect(formatBRL(1990)).not.toContain(' ');
  });
});

describe('the resilience primitives a bespoke client is built on', () => {
  it('retries a failing task and returns the first success', async () => {
    // A container's property rather than a closed-over binding: the flakiness
    // gate refuses the latter from inside a stub, and it is right to — a
    // reassignment there survives into the next test in the file.
    const calls = { count: 0 };
    const task = vi.fn(async () => {
      calls.count += 1;
      if (calls.count < 3) throw new Error('provider said no');
      return 'charged';
    });

    // `baseDelayMs: 0` so the assertion is about ATTEMPTS, never about elapsed
    // time — a suite that waited on a real backoff would be asserting how fast
    // the machine is.
    await expect(withRetry(task, { retries: 3, baseDelayMs: 0 })).resolves.toBe('charged');
    expect(task).toHaveBeenCalledTimes(3);
  });

  it('stops at the caller signal rather than burning the whole ladder', async () => {
    // `shouldRetry` is the hook that separates "the provider is down" from
    // "the request was malformed", and re-sending the second is how a client
    // turns one bad request into four.
    const task = vi.fn(async () => {
      throw new Error('422 unprocessable');
    });

    await expect(
      withRetry(task, { retries: 5, baseDelayMs: 0, shouldRetry: () => false }),
    ).rejects.toThrow('422 unprocessable');
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('maps with a concurrency cap and still returns things in INPUT order', async () => {
    // Both halves matter and they pull against each other: the cap means the
    // work completes out of order, and the contract is that the result does
    // not. A caller zipping this against its input list is the thing that
    // breaks, silently, if completion order ever leaks through.
    const inFlight = { now: 0, peak: 0 };
    const items = [1, 2, 3, 4, 5, 6, 7, 8];

    const mapped = await mapWithConcurrency(items, 3, async (item) => {
      inFlight.now += 1;
      inFlight.peak = Math.max(inFlight.peak, inFlight.now);
      // Yield to the loop so the other tasks in the window actually overlap;
      // no timer, so nothing here depends on a duration.
      await Promise.resolve();
      inFlight.now -= 1;
      return item * 2;
    });

    expect(mapped).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
    // Exactly the cap, not merely under it. `toBeLessThanOrEqual` alone passes
    // for a limiter that ran everything one at a time — which is a different
    // bug wearing the same green tick, and the expensive one for a caller that
    // sized its concurrency against a provider's rate limit.
    expect(inFlight.peak).toBe(3);
  });
});
