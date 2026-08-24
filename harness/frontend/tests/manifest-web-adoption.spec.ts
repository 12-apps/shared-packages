/* eslint-disable test-flakiness/no-unmocked-fs -- the installed tree IS the
   subject, exactly as in the backend harness's `published-subpaths.test.ts`
   and its `manifest-adoption.test.ts` twin. Every path read below is inside
   harness/frontend/node_modules, i.e. inside the tarballs this harness was
   installed from. A mock would make this gate assert against a list somebody
   typed, which is the one thing it must never do: the whole point is to
   compare what was INSTALLED against what the host answered for, and a
   hand-written stand-in for the first half would let a package go unadopted
   and still pass. */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

/**
 * THE COMPLETENESS GATE: every package that declares a web surface is adopted
 * by this host.
 *
 * This is the check whose absence let three packages ship unadopted web
 * manifests unnoticed — `@12-apps/discounts` with no presence in this app at
 * all, `@12-apps/onboarding` and `@12-apps/payments-frontend` used through
 * direct imports while their manifests went unbound.
 *
 * ## Why the existing report could not catch them
 *
 * `wiring-report.spec.ts` asserts that nothing ADOPTED is unanswered, and
 * `assemble()` refuses to return while any adopted package has a declared
 * capability nobody bound. Both are claims about packages the host adopted.
 *
 * A package the host never adopts is not an unanswered capability — it is a
 * package the report never hears about. So the failure had no symptom at any
 * level: every screen rendered, every suite passed, and the report was
 * complete about the twelve it knew.
 *
 * That is a COMPLETENESS property, and the only way to check one is from
 * outside: enumerate what is INSTALLED, then compare against what the host
 * answered for. This spec is the one place in the estate that reads both.
 *
 * ## Why the names are read out of the manifest rather than the directory
 *
 * A package is not one manifest. `@12-apps/auth` ships `@12-apps/auth` and
 * `@12-apps/auth-platform`; `@12-apps/payments-frontend` ships itself and
 * `@12-apps/payments-checkout-ui` — deliberately, so a host adopts the buyer's
 * checkout into a storefront without dragging the owner's settings screen in
 * with it. A gate keyed on directory names would have counted those four as
 * two and passed while half of them were unbound.
 *
 * Read as TEXT rather than imported: these manifests are the producer half, so
 * importing one pulls in React component types (and, for the source-exported
 * packages, raw TypeScript that this Node context does not transform). The
 * shapes are small literal objects, and the extraction is guarded below —
 * finding NO name in a file that exports a web manifest fails, so a regex that
 * silently stopped matching cannot read as "everything is adopted".
 */

/** Where the packed tarballs were installed. */
function installedPackages(): string[] {
  const root = join(process.cwd(), 'node_modules', '@12-apps');
  return readdirSync(root).map((name) => `@12-apps/${name}`);
}

/**
 * The file a package's `./manifest/web` subpath resolves to, or null.
 *
 * The manifest is read off DISK rather than through `require`: several of these
 * packages do not export `./package.json` at all, and a resolver-based read
 * throws on them — which would make this gate fail for a reason that has
 * nothing to do with what it checks.
 */
function webManifestFile(pkg: string): string | null {
  const dir = join(process.cwd(), 'node_modules', pkg);
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
    exports?: Record<string, string | Record<string, string>>;
  };
  const entry = manifest.exports?.['./manifest/web'];
  if (entry === undefined) return null;
  const relative = typeof entry === 'string' ? entry : (entry['default'] ?? entry['types']);
  if (relative === undefined) return null;
  return join(dir, relative);
}

/** Every manifest NAME declared in one package's web manifest. */
function declaredNames(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  return [...source.matchAll(/name: *['"]([^'"]+)['"]/gu)].map((match) => match[1] as string);
}

test('every installed package that declares a web surface is adopted by this host', async ({
  page,
}) => {
  const expected = new Set<string>();
  const shippers: string[] = [];

  for (const pkg of installedPackages()) {
    const file = webManifestFile(pkg);
    if (file === null) continue;
    shippers.push(pkg);

    const names = declaredNames(file);
    // The guard on the guard. A package exporting `./manifest/web` declares at
    // least one manifest by definition, so zero names means the extraction
    // broke — and a broken extraction produces an EMPTY expectation, which
    // passes. That is the silent direction, so it is an assertion.
    expect(names, `no manifest name found in ${pkg}'s web manifest`).not.toHaveLength(0);
    names.forEach((name) => expected.add(name));
  }

  // And the guard on THAT: an empty install tree would make the loop above
  // vacuous. This app depends on more than a handful of web manifests, so a
  // count near zero is a broken fixture rather than a tidy estate.
  expect(shippers.length).toBeGreaterThan(5);

  await page.goto('/#/wiring-report');
  await expect(page.getByTestId('wiring-report')).toBeVisible();

  const adopted = await page
    .locator('[data-testid^="wiring-package-"]')
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-testid')?.replace('wiring-package-', '') ?? ''),
    );

  const missing = [...expected].filter((name) => !adopted.includes(name)).sort();

  // Named, not counted: the point of the failure message is to say WHICH
  // package shipped a surface this host never bound, because that is the whole
  // content of the finding.
  expect(missing, `declared a web surface but no host adopted it: ${missing.join(', ')}`).toEqual(
    [],
  );
});
