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
  FUTURE_PAY_PUBLISHER_DECLARATIONS,
  runPublisherParity,
  type PublisherEntry,
} from '@12-apps/realtime/parity';

/**
 * The publisher-parity gate, exercised the way a HOST runs it — out of the packed tarball,
 * against a real repo layout on disk.
 *
 * The package's own suite covers the rules. This one covers the ADOPTION: that `./parity`
 * resolves for a consumer, that its shipped future-pay defaults are usable as-is, and that a
 * host's `.realtime-silent-domains.json` sitting at the repo root is found with no
 * configuration. #150 shipped a `./coverage` export that resolved for nobody, and the review
 * of #156 found two subpaths no test imported — a gate a host cannot actually run is the same
 * failure wearing a different name.
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

/** Every future-pay publisher module, as a file that really emits. */
function futurePayModules(): Record<string, string> {
  return {
    [DEFAULT_SILENT_BASELINE]: EMPTY_RATCHET,
    ...Object.fromEntries(
      FUTURE_PAY_PUBLISHER_DECLARATIONS.filter(
        (entry) => entry.declaration.kind === 'publishes',
      ).map((entry) => [
        (entry.declaration as { module: string }).module,
        'await publishRealtimeEvent(topic, { type: "x", data: {} });\n',
      ]),
    ),
  };
}

/** The first declared publisher, and the module path it claims. */
function firstPublisherModule(): string {
  const [first] = FUTURE_PAY_PUBLISHER_DECLARATIONS;
  if (!first || first.declaration.kind !== 'publishes') throw new Error('no publisher declared');
  return first.declaration.module;
}

/** `futurePayModules()` with one entry replaced — a named helper, not a test-body mutation. */
function modulesWith(path: string, contents: string): Record<string, string> {
  return { ...futurePayModules(), [path]: contents };
}

/** `futurePayModules()` with one entry removed. */
function modulesWithout(path: string): Record<string, string> {
  const { [path]: _removed, ...rest } = futurePayModules();
  return rest;
}

describe('@12-apps/realtime/parity — a host can run this gate', () => {
  it('passes on a repo whose declared publishers all emit, with zero configuration', () => {
    // The shipped defaults plus a root ratchet file: no `declarations`, no `baselineFile`.
    const root = fakeHost(futurePayModules());
    expect(runPublisherParity({ root })).toMatchObject({
      ok: true,
      problems: [],
      silent: [],
      publishing: FUTURE_PAY_PUBLISHER_DECLARATIONS.length,
    });
  });

  it('fails when one declared publisher stops emitting', () => {
    // The exact regression this gate exists for: a module still there, its call gone.
    const root = fakeHost(
      modulesWith(firstPublisherModule(), 'export function publishKitchenChanged() { /* TODO */ }\n'),
    );
    const result = runPublisherParity({ root });
    expect(result.ok).toBe(false);
    expect(result.problems.join('\n')).toContain('never calls publishRealtimeEvent');
  });

  it('fails when a host deletes a declared publisher module', () => {
    const result = runPublisherParity({ root: fakeHost(modulesWithout(firstPublisherModule())) });
    expect(result.ok).toBe(false);
    expect(result.problems.join('\n')).toContain('does not exist');
  });

  it('refuses to grandfather a NEW silent domain', () => {
    const silent: PublisherEntry = {
      scheme: 'tenant',
      domain: 'novo',
      declaration: { kind: 'silent', ticket: '12-99', why: 'no emitter yet' },
    };
    const result = runPublisherParity({
      root: fakeHost({ [DEFAULT_SILENT_BASELINE]: EMPTY_RATCHET }),
      declarations: [...FUTURE_PAY_PUBLISHER_DECLARATIONS, silent],
    });
    expect(result.ok).toBe(false);
    expect(result.problems.join('\n')).toContain('may only shrink');
  });

  it('fails when the host has no ratchet file at all', () => {
    const result = runPublisherParity({ root: fakeHost(modulesWithout(DEFAULT_SILENT_BASELINE)) });
    expect(result.ok).toBe(false);
    expect(result.problems.join('\n')).toContain('missing baseline');
  });
});
