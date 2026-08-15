/* eslint-disable test-flakiness/no-unmocked-fs -- the filesystem IS the subject: this gate
   reads a host's declared publisher modules and its ratchet file, so mocking the reads would
   leave the suite asserting against a fixture rather than against the behaviour that fails a
   host's CI. Every path is inside a fresh mkdtemp per case. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SILENT_BASELINE,
  runPublisherParity,
  type PublisherEntry,
  type PublisherParityDomains,
} from '@12-apps/realtime/parity';

/**
 * The publisher-parity gate, exercised the way a HOST runs it — out of the packed tarball,
 * against a real repo layout on disk.
 *
 * The package's own suite covers the rules. This one covers the ADOPTION: that `./parity`
 * resolves for a consumer, that a host-authored declaration list drives it end to end, and
 * that a host's `.realtime-silent-domains.json` sitting at the repo root is
 * found with no configuration. #150 shipped a `./coverage` export that resolved for nobody,
 * and the review of #156 found two subpaths no test imported — a gate a host cannot actually
 * run is the same failure wearing a different name.
 *
 * ## What this file deliberately no longer asserts
 *
 * It used to say the gate "passes … with zero configuration" — no `declarations`, no
 * `domains` — which blessed the exact hole that made the gate fail open: with the host's
 * lists optional, a domain added to `REALTIME_DOMAINS` and forgotten in the map was not a
 * violation but silence. Both are inputs now, so a host's registry is what the gate is
 * complete AGAINST, and the completeness case below is the one that would have caught it.
 */

/** A throwaway host repo with the files a case needs. */
function fakeHost(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'realtime-parity-host-'));
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}

/** The ratchet a host commits: empty, and shrink-only from there. */
const EMPTY_RATCHET = JSON.stringify({
  _comment: [
    'Domains that can be SUBSCRIBED to and emit nothing.',
    'A subscriber connects, is told it is live, slows its poll — and never hears a word.',
    'This list may only SHRINK. The gate refuses a new entry, so a new domain must ship',
    'with its publisher; and it refuses a stale entry, so paying the debt is permanent.',
  ],
  silent: [],
});

/**
 * A host's declarations, authored HERE the way an adopter authors its own: one entry per
 * subscribable domain, each naming the repo-relative module that emits for it. The package
 * deliberately ships no example to fall back on — a completeness gate cannot supply its
 * own subject — so the harness plays the adopter and declares a small registry of its own.
 */
const EXAMPLE_DECLARATIONS: readonly PublisherEntry[] = [
  { scheme: 'tenant', domain: 'orders', declaration: { kind: 'publishes', module: 'src/realtime/order-hints.ts' } },
  { scheme: 'tenant', domain: 'billing', declaration: { kind: 'publishes', module: 'src/realtime/billing-hints.ts' } },
  { scheme: 'tenant', domain: 'inventory', declaration: { kind: 'publishes', module: 'src/realtime/inventory-hints.ts' } },
  { scheme: 'user', domain: 'alerts', declaration: { kind: 'publishes', module: 'src/realtime/user-hints.ts' } },
  { scheme: 'user', domain: 'consent', declaration: { kind: 'publishes', module: 'src/realtime/user-hints.ts' } },
];

/** Every declared publisher module, as a file that really emits. */
function exampleModules(): Record<string, string> {
  return {
    [DEFAULT_SILENT_BASELINE]: EMPTY_RATCHET,
    ...Object.fromEntries(
      EXAMPLE_DECLARATIONS.filter((entry) => entry.declaration.kind === 'publishes').map((entry) => [
        (entry.declaration as { module: string }).module,
        'await publishRealtimeEvent(topic, { type: "x", data: {} });\n',
      ]),
    ),
  };
}

/** The registry the example declarations are complete against, derived from them. */
function exampleDomains(): PublisherParityDomains {
  const of = (scheme: 'tenant' | 'user'): string[] =>
    EXAMPLE_DECLARATIONS.filter((entry) => entry.scheme === scheme).map((entry) => entry.domain);
  return { tenant: of('tenant'), user: of('user') };
}

/** The gate as a host runs it: its own declarations, its own registry, its own root. */
function parityOf(root: string, overrides: Partial<Parameters<typeof runPublisherParity>[0]> = {}) {
  return runPublisherParity({
    root,
    declarations: EXAMPLE_DECLARATIONS,
    domains: exampleDomains(),
    ...overrides,
  });
}

/** The first declared publisher, and the module path it claims. */
function firstPublisherModule(): string {
  const [first] = EXAMPLE_DECLARATIONS;
  if (!first || first.declaration.kind !== 'publishes') throw new Error('no publisher declared');
  return first.declaration.module;
}

/** `exampleModules()` with one entry replaced — a named helper, not a test-body mutation. */
function modulesWith(path: string, contents: string): Record<string, string> {
  return { ...exampleModules(), [path]: contents };
}

/** `exampleModules()` with one entry removed. */
function modulesWithout(path: string): Record<string, string> {
  const { [path]: _removed, ...rest } = exampleModules();
  return rest;
}

describe('@12-apps/realtime/parity — a host can run this gate', () => {
  it('passes on a repo whose registry, declarations and publisher modules all agree', () => {
    // The example declarations paired with the registry they cover, plus a root ratchet
    // file: no `baselineFile`, so the default `.realtime-silent-domains.json` is found.
    const root = fakeHost(exampleModules());
    expect(parityOf(root)).toMatchObject({
      ok: true,
      problems: [],
      silent: [],
      publishing: EXAMPLE_DECLARATIONS.length,
    });
  });

  it('FAILS when the host registers a domain its map never declares', () => {
    // The regression the gate exists for, and the one it could not see while the host's
    // lists were optional: `tenant:stock` is subscribable, so a screen connects, is told it
    // is live and relaxes its poll to 30 s — and no publisher was ever written.
    const domains = exampleDomains();
    const result = parityOf(fakeHost(exampleModules()), {
      domains: { ...domains, tenant: [...domains.tenant, 'stock'] },
    });
    expect(result.ok).toBe(false);
    expect(result.problems.join('\n')).toContain('declare no publisher at all: tenant:stock');
  });

  it('fails when one declared publisher stops emitting', () => {
    // The exact regression this gate exists for: a module still there, its call gone.
    const root = fakeHost(
      modulesWith(firstPublisherModule(), 'export function publishKitchenChanged() { /* TODO */ }\n'),
    );
    const result = parityOf(root);
    expect(result.ok).toBe(false);
    expect(result.problems.join('\n')).toContain('never calls publishRealtimeEvent');
  });

  it('fails when a host deletes a declared publisher module', () => {
    const result = parityOf(fakeHost(modulesWithout(firstPublisherModule())));
    expect(result.ok).toBe(false);
    expect(result.problems.join('\n')).toContain('does not exist');
  });

  it('refuses to grandfather a NEW silent domain', () => {
    const silent: PublisherEntry = {
      scheme: 'tenant',
      domain: 'novo',
      declaration: { kind: 'silent', ticket: '12-99', why: 'no emitter yet' },
    };
    const domains = exampleDomains();
    const result = parityOf(fakeHost({ [DEFAULT_SILENT_BASELINE]: EMPTY_RATCHET }), {
      declarations: [...EXAMPLE_DECLARATIONS, silent],
      domains: { ...domains, tenant: [...domains.tenant, 'novo'] },
    });
    expect(result.ok).toBe(false);
    expect(result.problems.join('\n')).toContain('may only shrink');
  });

  it('fails when the host has no ratchet file at all', () => {
    const result = parityOf(fakeHost(modulesWithout(DEFAULT_SILENT_BASELINE)));
    expect(result.ok).toBe(false);
    expect(result.problems.join('\n')).toContain('missing baseline');
  });
});
