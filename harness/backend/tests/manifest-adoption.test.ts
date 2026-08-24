/* eslint-disable test-flakiness/no-unmocked-fs -- the installed tree IS the
   subject, exactly as in `published-subpaths.test.ts` beside this file. Every
   path read below is inside harness/backend/node_modules, i.e. inside the
   tarballs this harness was installed from. A mock would make this gate assert
   against a list somebody typed, which is the one thing it must never do: the
   whole point is to compare what was INSTALLED against what the hosts
   answered for, and a hand-written stand-in for the first half would let a
   package go unadopted and still pass. */
/**
 * THE COMPLETENESS GATE for the server runtime: every package that declares a
 * server surface is adopted by this host.
 *
 * The sibling half lives in the frontend harness
 * (`tests/manifest-web-adoption.spec.ts`) and exists for the same reason. Six
 * packages shipped manifests nothing bound — three web, three server — and not
 * one of them was red anywhere.
 *
 * ## Why nothing could catch them
 *
 * `assemble()` refuses to return while any ADOPTED package has a declared
 * capability nobody bound, and every host suite here asserts its own report is
 * clean. Both are claims about packages a host adopted.
 *
 * A package the host never adopts is not an unanswered capability — it is a
 * package no report hears about. `@12-apps/app-shell`, `@12-apps/mcp` and
 * `@12-apps/pwa` were each mounted through their own `/hono` router, which
 * works perfectly: every endpoint answered, every suite passed, and three
 * declared surfaces were bound by nothing.
 *
 * That is a COMPLETENESS property, and a completeness property can only be
 * checked from OUTSIDE the thing it is about: enumerate what is INSTALLED, then
 * compare against what the hosts answered for.
 *
 * ## Why the names come out of the manifest rather than the directory
 *
 * A package is not one manifest. `@12-apps/auth` ships `@12-apps/auth` and
 * `@12-apps/auth-platform`; `@12-apps/payments-backend` splits the merchant
 * library from the buyer's checkout on purpose, so a host can mount one without
 * the other. A gate keyed on directory names would count those pairs as one and
 * pass while half of them were unbound.
 *
 * Read as TEXT rather than imported: importing a producer manifest pulls in the
 * package's whole server half, and the shapes are small literal objects. The
 * extraction is guarded — a file that exports a server manifest and yields NO
 * name fails, so a regex that quietly stopped matching cannot read as
 * "everything is adopted".
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, expect, it } from 'vitest';

import { createHarnessBackend, type HarnessBackend } from '../src/app';

let backend: HarnessBackend;

beforeAll(async () => {
  backend = await createHarnessBackend();
}, 120_000);

afterAll(async () => {
  await backend.close();
});

const MODULES = join(process.cwd(), 'node_modules');

/**
 * Manifests this backend deliberately does NOT adopt, each with its reason.
 *
 * A `why` rather than a bare list, and that is this repo's own convention for
 * every ratchet it keeps (`.payments-surface.json`, `.adapter-surface.json`):
 * a label is not an argument. An exemption that costs a written sentence is one
 * somebody had to mean; a list of names is where a gate goes to die.
 *
 * The bar is that the surface IS adopted somewhere, or that adopting it here
 * would be wrong — never that it was inconvenient.
 */
const NOT_OURS: Readonly<Record<string, string>> = {
  '@12-apps/payments-checkout':
    "the BUYER half, and it is adopted in harness/frontend instead — that is where a buyer " +
    "journey runs, so the payables book, the correlation port and the tokenizer path live " +
    "there. The package ships two manifests precisely so a host can bind one without the " +
    "other (every library row is merchant-scoped, every checkout row is the buyer), and " +
    "mounting a second buyer surface here would be a second answer to the same questions. " +
    "See the 'Why the BUYER mount is not here' section of src/payments-host.ts.",
};

/** Every `@12-apps/*` the harness installed from a packed tarball. */
function installedPackages(): string[] {
  return readdirSync(join(MODULES, '@12-apps')).map((name) => `@12-apps/${name}`);
}

/**
 * The file a package's `./manifest/server` subpath resolves to, or null.
 *
 * Read off DISK rather than through the resolver: several of these packages do
 * not export `./package.json`, and a resolver-based read throws on them — which
 * would fail this gate for a reason unrelated to what it checks.
 */
function serverManifestFile(pkg: string): string | null {
  const dir = join(MODULES, pkg);
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
    exports?: Record<string, string | Record<string, string>>;
  };
  const entry = manifest.exports?.['./manifest/server'];
  if (entry === undefined) return null;
  const relative = typeof entry === 'string' ? entry : (entry['default'] ?? entry['types']);
  return relative === undefined ? null : join(dir, relative);
}

/** Every manifest NAME declared in one package's server manifest. */
function declaredNames(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  return [...source.matchAll(/name: *['"]([^'"]+)['"]/gu)].map((match) => match[1] as string);
}

/** Every package name any host in this backend reported on. */
function adoptedNames(): Set<string> {
  const names = new Set<string>();
  for (const host of Object.values(backend.hosts as Record<string, unknown>)) {
    const report = (host as { report?: { packages?: { packageName: string }[] } })?.report;
    report?.packages?.forEach((entry) => names.add(entry.packageName));
  }
  return names;
}

it('adopts every installed package that declares a server surface', () => {
  const expected = new Set<string>();
  const shippers: string[] = [];

  for (const pkg of installedPackages()) {
    const file = serverManifestFile(pkg);
    if (file === null) continue;
    shippers.push(pkg);

    const declared = declaredNames(file);
    // The guard on the guard. A package exporting `./manifest/server` declares
    // at least one manifest by definition, so zero names means the extraction
    // broke — and a broken extraction yields an EMPTY expectation, which
    // passes. That is the silent direction, so it is an assertion.
    expect(declared, `no manifest name found in ${pkg}'s server manifest`).not.toHaveLength(0);
    declared.forEach((name) => expected.add(name));
  }

  // And the guard on THAT: an empty install tree would make the loop vacuous.
  expect(shippers.length).toBeGreaterThan(10);

  const adopted = adoptedNames();
  const missing = [...expected]
    .filter((name) => !adopted.has(name))
    .filter((name) => NOT_OURS[name] === undefined)
    .sort();

  // An exemption for a manifest that no longer exists is a sentence nobody will
  // ever re-read, and a gate carrying stale entries is one that has quietly
  // stopped describing the estate. Same direction as the `stale exemption`
  // failure the MCP test-coverage gate raises.
  const stale = Object.keys(NOT_OURS).filter((name) => !expected.has(name)).sort();
  const staleMessage = `exempted a manifest nothing declares any more: ${stale.join(', ')}`;
  expect(stale, staleMessage).toEqual([]);

  // Named, not counted: which package shipped a surface no host bound IS the
  // finding, and a count would send the next reader back to reproduce it.
  const unbound = `declared a server surface but no host adopted it: ${missing.join(', ')}`;
  expect(missing, unbound).toEqual([]);
});
