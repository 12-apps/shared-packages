// @vitest-environment jsdom
/**
 * EVERY PUBLISHED ENTRY POINT, against the guard behind it.
 *
 * A guard that lives on the newest factory protects the newest factory. The
 * documented adoption path is not always that one: this package's ADOPTING
 * table names four importable surfaces, and three of them can assemble an audit
 * surface on their own — `./server` through `createApiAudit`, `./hono` through
 * `auditRouter`, `./react` through `createWebAudit`. A host that mounts only the
 * viewer never calls the server factory at all.
 *
 * So this suite reads the `exports` map out of `package.json` rather than a
 * hand-kept list (a second copy would rot in the direction of not looking), pins
 * the set so a NEW subpath cannot arrive unreviewed, and then walks each one to
 * the hazard behind it.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { AuditConfigError } from '../core/errors';
import { defineAuditVocabulary, type AuditVocabulary } from '../core/vocabulary';
import * as rootEntry from '../index';
import * as honoEntry from '../hono/index';
import { auditRouter } from '../hono/index';
import * as serverEntry from '../server/index';
import { createWebAudit } from '../react/create-web-audit';
import { applyAppendOnlyGuard } from '../server/append-only-extension';
import type { AuditDb, AuditServerConfig } from '../server/index';
import { createApiAudit } from '../server/create-api-audit';
import { createAuditRetention } from '../server/retention';
import { createAuditWriter } from '../server/writer';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/* eslint-disable test-flakiness/no-unmocked-fs --
   the manifest on disk IS the subject: the question is what this package
   promises a consumer, and a mocked manifest would answer with what the test
   promised. */
function publishedSubpaths(): string[] {
  const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
    exports: Record<string, string>;
  };
  return Object.keys(manifest.exports).sort();
}
/* eslint-enable test-flakiness/no-unmocked-fs */

/** A minimal, legitimate vocabulary — a lighthouse service, not the origin. */
const beacons = (): AuditVocabulary =>
  defineAuditVocabulary({
    actions: { 'lamp.relight': { label: 'Lamp relit' } },
    resources: { lamp: { label: 'Lamp', fields: ['lumens'] } },
  });

const noopDb = (): AuditDb => ({
  auditLog: {
    create: () => Promise.resolve({}),
    findMany: () => Promise.resolve([]),
    count: () => Promise.resolve(0),
  },
  $executeRawUnsafe: () => Promise.resolve(0),
});

const serverConfig = (overrides: Partial<AuditServerConfig> = {}): AuditServerConfig => ({
  db: () => Promise.resolve(noopDb()),
  resolveActor: () => null,
  vocabulary: beacons(),
  ...overrides,
});

/**
 * A vocabulary-shaped object the factory never built.
 *
 * The shape a host reaches for by accident: a config restored from JSON, or a
 * literal written against the published interface. Every assembly refusal is
 * invisible to it, which is why every door has to check.
 */
const unbuilt = (): AuditVocabulary =>
  ({
    actionIds: ['lamp.relight'],
    resourceIds: ['lamp'],
    hasAction: () => true,
    hasResource: () => true,
    allowlistFor: () => new Set<string>(),
    actionLabel: (id: string) => id,
    resourceLabel: (id: string) => id,
  }) as unknown as AuditVocabulary;

describe('the published entry points', () => {
  /**
   * A `use`-prefixed export on a NON-React entry is a lint bomb in the adopter's
   * repo, not a naming quibble.
   *
   * `react-hooks/rules-of-hooks` decides what a hook is from the identifier
   * alone. It cannot know that `./server` is `node:async_hooks` code that will
   * never see a render, and it does not look: a `use…()` call at module scope is
   * reported as a hook called outside a component. Wiring code runs at module
   * scope by definition, and this package ships a `./react` entry — so its
   * adopters lint with that rule on, over the same tree that holds their server
   * wiring. The first adopter of `declareActorContextKey` paid for this with a
   * red `--max-warnings 0` lane on a call that was entirely correct, and the
   * only fixes available to them were suppressing a rule or renaming ours.
   *
   * So the constraint belongs here, where a rename is still cheap. `./react`
   * is deliberately exempt: a hook there SHOULD be `use`-prefixed.
   */
  it('never `use`-prefix a name outside `./react`', () => {
    const hookish = (entry: Record<string, unknown>): string[] =>
      Object.keys(entry)
        .filter((name) => /^use[A-Z]/.test(name))
        .sort();

    expect(hookish(rootEntry)).toEqual([]);
    expect(hookish(serverEntry)).toEqual([]);
    expect(hookish(honoEntry)).toEqual([]);
  });

  it('are exactly these four, plus the manifest', () => {
    // Pinned, so adding a subpath is a deliberate act that lands in this diff
    // together with whatever guard the new surface needs.
    expect(publishedSubpaths()).toEqual([
      '.',
      './hono',
      './package.json',
      './react',
      './server',
    ]);
  });
});

describe('`.` — the framework-free root', () => {
  it('is where the refusals live, and they fire from here', () => {
    // The root is a first-class adoption path: a surface that must not pull a
    // database client in imports it to build the vocabulary a doc generator or
    // an offline tool registry reads.
    expect(() =>
      defineAuditVocabulary({
        actions: { 'lamp.relight': { label: 'Lamp relit' } },
        resources: { lamp: { label: 'Lamp', fields: [] } },
      }),
    ).toThrow(AuditConfigError);
  });
});

describe('`./server` — the backend factory and the pieces beside it', () => {
  it('refuses a vocabulary the factory never built', () => {
    expect(() => createApiAudit(serverConfig({ vocabulary: unbuilt() }))).toThrow(
      AuditConfigError,
    );
  });

  it('refuses it at the WRITER too, which a job reaches without the factory', () => {
    // A host that writes entries from a queue consumer or a backfill script and
    // never mounts the read surface calls this directly. It must not be the
    // path with fewer guards.
    expect(() => createAuditWriter(unbuilt())).toThrow(AuditConfigError);
  });

  it('refuses a retention floor that bounds nothing, at construction', () => {
    // `0` reads as "no retention" and means "keep nothing": the cutoff lands at
    // `now`, so the first sweep deletes the whole trail.
    expect(() =>
      createAuditRetention(() => Promise.resolve(noopDb()), { floorDays: 0 }),
    ).toThrow(AuditConfigError);
    expect(() =>
      createAuditRetention(() => Promise.resolve(noopDb()), { floorDays: Number.NaN }),
    ).toThrow(AuditConfigError);
    // …and from the factory, which is the documented path.
    expect(() => createApiAudit(serverConfig({ retention: { floorDays: -1 } }))).toThrow(
      AuditConfigError,
    );
  });

  it('refuses an append-only guard over no models, called directly', () => {
    // `createApiAudit` always includes this package's own model, so it cannot
    // reach this — the refusal is here because the function is EXPORTED, and a
    // host composing its own Prisma client calls it itself. A guard over an
    // empty set installs a hook that permits every mutation and looks installed.
    expect(() => applyAppendOnlyGuard({ $extends: () => ({}) }, { models: [] })).toThrow(
      AuditConfigError,
    );
  });

  it('refuses a blank message, gate id or page size', () => {
    expect(() => createApiAudit(serverConfig({ messages: { forbidden: '  ' } }))).toThrow(
      /messages\.forbidden/,
    );
    expect(() => createApiAudit(serverConfig({ gatePermissions: { read: '' } }))).toThrow(
      /gatePermissions\.read/,
    );
    expect(() => createApiAudit(serverConfig({ pagination: { maxPageSize: 0 } }))).toThrow(
      /pagination\.maxPageSize/,
    );
    expect(() =>
      createApiAudit(serverConfig({ pagination: { defaultPageSize: 500, maxPageSize: 100 } })),
    ).toThrow(/pagination\.defaultPageSize/);
  });

  it('refuses a model name with surrounding whitespace, on both model lists', () => {
    // A padded name matches no model, so the stamp or the guard the host
    // believes it declared never fires — and nothing about it looks disabled.
    expect(() => createApiAudit(serverConfig({ trackedModels: ['Lamp '] }))).toThrow(
      /trackedModels/,
    );
    expect(() => createApiAudit(serverConfig({ appendOnlyModels: [' Ledger'] }))).toThrow(
      /appendOnlyModels/,
    );
  });

  it('always guards its own model, whatever the host adds', () => {
    const applied: { name: string; query: Record<string, unknown> }[] = [];
    const client = {
      $extends(extension: unknown) {
        applied.push(extension as { name: string; query: Record<string, unknown> });
        return this;
      },
    };
    const api = createApiAudit(serverConfig({ appendOnlyModels: ['Ledger'] }));
    api.extensions.appendOnly(client);

    const guard = applied.find((extension) => extension.name === 'appendOnlyGuard');
    const hooks = (guard?.query as { $allModels: Record<string, (a: unknown) => unknown> })
      .$allModels;
    const call = (model: string) =>
      hooks.delete?.({ model, args: {}, query: () => undefined });

    expect(() => call('AuditLog')).toThrow(/AuditLog is append-only/);
    expect(() => call('Ledger')).toThrow(/Ledger is append-only/);
    expect(call('Lamp')).toBeUndefined();
  });
});

describe('`./hono` — the adapter', () => {
  it('reaches every server refusal, because it builds the surface itself', () => {
    // `auditRouter` takes the whole server config and calls `createApiAudit`, so
    // a host that only ever imports the adapter still meets each guard. If it
    // ever grew its own assembly path, this case is what would notice.
    expect(() => auditRouter(serverConfig({ vocabulary: unbuilt() }))).toThrow(AuditConfigError);
    expect(() => auditRouter(serverConfig({ retention: { floorDays: 0 } }))).toThrow(
      AuditConfigError,
    );
  });
});

describe('`./react` — the viewer factory', () => {
  it('refuses a vocabulary the factory never built', () => {
    // The door with no server behind it: a host embedding the trail in an
    // admin SPA calls this and nothing else in the package.
    expect(() => createWebAudit({ apiBase: '/api', vocabulary: unbuilt() })).toThrow(
      AuditConfigError,
    );
  });

  it('refuses a blank label override', () => {
    // A blank label renders an empty cell or an empty button — a screen that
    // reads as broken rather than as untranslated.
    expect(() =>
      createWebAudit({ apiBase: '/api', vocabulary: beacons(), labels: { title: '   ' } }),
    ).toThrow(/labels\.title/);
  });

  it('has no vocabulary to fall back to', () => {
    // The defect this release exists to remove: the viewer used to default to
    // the extraction origin's catalog, so a host that forgot to pass its own
    // rendered another product's filter bar over its own rows.
    expect(() =>
      // @ts-expect-error — the compiler refuses it too, which is the point:
      // there is no shape of this config that omits the vocabulary.
      createWebAudit({ apiBase: '/api' }),
    ).toThrow(AuditConfigError);
  });
});
