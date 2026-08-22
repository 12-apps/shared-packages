import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

import type { ProviderCopyPacks } from '../providers/copy';
import { providerCatalog } from '../providers/catalog';
import { PT_BR_PROVIDER_COPY } from '../providers/pt-BR';

/**
 * The catalog with each factory's pack already bound, so the sweeps below stay
 * about the ADAPTERS rather than about who supplies their words.
 *
 * Enumerated from `providerCatalog` itself, for the reason the catalog exists:
 * a helper that retyped the four names would stop covering the fifth adapter
 * the moment one is added, which is precisely the failure this file guards.
 */
function catalogWithCopy(): Record<string, () => ReturnType<typeof providerCatalog.stone>> {
  return Object.fromEntries(
    Object.entries(providerCatalog).map(([name, create]) => [
      name,
      () =>
        (create as (pack: ProviderCopyPacks[keyof ProviderCopyPacks]) => ReturnType<typeof create>)(
          PT_BR_PROVIDER_COPY[name as keyof ProviderCopyPacks],
        ),
    ]),
  );
}

/**
 * FUT-595 — the guard that keeps the contract sweeps whole.
 *
 * The buyer-requirements invariants in `customer-schema.test.ts` are claims
 * about EVERY adapter ("no adapter requires name or e-mail for PIX/CARD",
 * "every REDIRECT adapter's methods settle on the hosted page"). They sweep
 * `providerCatalog`, so the claims are only as wide as that catalog is
 * complete: an adapter missing from it is never swept, and its violation
 * reports green.
 *
 * The package's own `exports` map is the second, independent statement of the
 * same set — a host reaches an adapter as `@12-apps/payments-backend/providers/
 * <name>` and cannot import one that has no entry there. That map is a
 * PUBLISHED surface here (this package is not private; it ships to npm), so a
 * new adapter has to be declared twice, and this file fails the moment the two
 * disagree.
 *
 * Loaded through `createRequire` rather than `readFileSync` (the pattern in
 * `packages/ui/src/__tests__/package-wiring.test.ts`): the committed manifest
 * IS the subject here — mocking it would make the check vacuous — and require
 * reads it without tripping the anti-flake fs rule.
 */

const requireJson = createRequire(import.meta.url);

interface PaymentsPackageJson {
  exports?: Record<string, string>;
}

const PROVIDER_SUBPATH = './providers/';

function readManifest(): PaymentsPackageJson {
  return requireJson('../../package.json') as PaymentsPackageJson;
}

/** The adapters the manifest publishes — one `./providers/<name>` entry each. */
function publishedProviderNames(): string[] {
  return Object.keys(readManifest().exports ?? {})
    .filter((subpath) => subpath.startsWith(PROVIDER_SUBPATH))
    .map((subpath) => subpath.slice(PROVIDER_SUBPATH.length))
    .sort();
}

describe('the provider catalog is the canonical adapter list (FUT-595)', () => {
  it('names exactly the adapters the package publishes to hosts', () => {
    expect(
      Object.keys(providerCatalog).sort(),
      'src/providers/catalog.ts must list every adapter published as ' +
        '"./providers/<name>" in this package\'s exports map. Add the missing ' +
        'adapter to the catalog: the FUT-595 contract sweeps in ' +
        '__tests__/customer-schema.test.ts enumerate it, so an adapter absent ' +
        'from the catalog is swept by nothing and its violations report green.',
    ).toEqual(publishedProviderNames());
  });

  it('keys the catalog by each adapter’s own registry name', () => {
    // What makes the comparison above meaningful: the manifest speaks in URL
    // subpaths and the catalog in registry names, so they are the same set only
    // while an adapter's name matches the subpath it is published under.
    for (const [name, createAdapter] of Object.entries(catalogWithCopy())) {
      expect(createAdapter().name, `catalog key "${name}"`).toBe(name);
    }
  });

  it('publishes each catalogued adapter from its own module', () => {
    // The other half of that chain, and the half a published package needs: a
    // subpath may point anywhere, so `./providers/<name>` is only evidence
    // about the adapter called `<name>` while it resolves to that adapter's
    // module. Consumers of this package import by subpath, not by file.
    const exportsMap = readManifest().exports ?? {};
    for (const name of Object.keys(providerCatalog)) {
      expect(exportsMap[`${PROVIDER_SUBPATH}${name}`], `exports["./providers/${name}"]`).toBe(
        `./src/providers/${name}.ts`,
      );
    }
  });

  it('builds a fresh adapter per call, so no sweep can leak into another', () => {
    // The catalog holds factories precisely so a sweep that stubs or mutates an
    // adapter cannot hand the next one a used instance.
    for (const createAdapter of Object.values(catalogWithCopy())) {
      expect(createAdapter()).not.toBe(createAdapter());
    }
  });
});
