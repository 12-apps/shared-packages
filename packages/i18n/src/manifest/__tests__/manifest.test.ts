import { describe, expect, it } from 'vitest';
import type { PackageManifest } from '@12-apps/wiring';
import {
  assertDbMirror,
  assertExportsMirror,
  defineManifest,
  defineServerManifest,
} from '@12-apps/wiring/producer';

import packageJson from '../../../package.json';
import { localeRoutes } from '../../server/locale-routes';
import { createApiLocale } from '../../server/create-api-locale';
import { i18nManifest } from '../index';
import { i18nServerManifest } from '../server';

/**
 * The producer half, asserted against what this package actually ships.
 *
 * The manifests are plain `satisfies`-checked values — `@12-apps/wiring` is a
 * type-only devDependency here, so the contract's RUNTIME assertions cannot run
 * at import. They run here instead, which keeps the same guarantee: a malformed
 * manifest fails in this package's own test run, before any host sees it.
 *
 * The `as const` literals are widened below for the cases whose point is to pin
 * an ABSENCE — a key the object does not carry is a compile error on the
 * literal, which is right for source and useless for an assertion about what a
 * host adopting the manifest actually holds.
 */
const shared: PackageManifest = i18nManifest;

const store = {
  read: async () => null,
  write: async () => null,
};

describe('the i18n producer manifest', () => {
  it('is accepted by the contract at runtime', () => {
    expect(defineManifest(i18nManifest)).toBe(i18nManifest);
    expect(defineServerManifest(i18nManifest, i18nServerManifest)).toBe(i18nServerManifest);
  });

  /**
   * The drift check that matters most. `db.partial` and `db.migrations` are
   * paths into this package, and `files` decides what `npm pack` ships — so a
   * manifest naming a partial the tarball omits is a host whose `assemble()`
   * succeeds and whose migration never runs. Green everywhere, no schema.
   */
  it('ships the schema partial and migrations it declares', () => {
    expect(() => assertDbMirror(i18nManifest, packageJson)).not.toThrow();
  });

  it('ships an export for every subpath the manifest implies', () => {
    expect(() => assertExportsMirror(i18nManifest, packageJson)).not.toThrow();
  });

  it('declares http, and does NOT declare a web half', () => {
    // The absence is the assertion. There is no screen here: a language
    // switcher is the host's own chrome, and shipping one would put this
    // package's markup inside every consumer's shell.
    expect(shared.server).toEqual(['http']);
    expect(shared.web).toBeUndefined();
  });

  it('inventories the same routes the factory builds', () => {
    // Two implementations of one list is how a manifest goes quietly stale:
    // the factory grows an endpoint, the declaration does not, and a host
    // mounts a surface its report says nothing about.
    const wire = createApiLocale({ store }).routes.map((r) => `${r.method} ${r.path}`);
    expect(wire).toEqual(localeRoutes({ store }).map((r) => `${r.method} ${r.path}`));
  });
});
