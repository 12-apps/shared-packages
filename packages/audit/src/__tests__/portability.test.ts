/* eslint-disable test-flakiness/no-test-isolation, test-flakiness/no-unmocked-fs --
   every `const` the isolation heuristic reads as shared state is built inside
   the case that uses it, by a factory over its own array. The filesystem read
   at the bottom IS the subject: the last describe walks this package's own
   source to prove the optional peers are never imported from the root or the
   server half. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { AuditConfigError } from '../core/errors';
import { defineAuditVocabulary, redactDiff } from '../core/vocabulary';
import { runWithActorScope, setActor } from '../server/actor-context';
import { createApiAudit } from '../server/create-api-audit';
import type { AuditDb, AuditLogCreateData, AuditLogRecord } from '../server/db';

import { foreignPatterns } from './foreign-vocabulary';

/**
 * A REAL SECOND HOST, in a domain the extraction origin does not touch.
 *
 * A portability claim is only worth what it is tested against, and testing it
 * against the application the package came out of proves nothing: that
 * application's vocabulary is the one that used to be compiled in. So the host
 * below is a **seed bank** — accessions, germination trials, a cold vault —
 * sharing no word with the origin, and the "fixtures themselves" describe
 * checks that claim against the same ban list the tarball sweep uses rather
 * than restating it.
 *
 * It wires the package the way ADOPTING.md says to: a vocabulary, an actor
 * resolver, a db seam, its own gate permission, its own copy and its own paging
 * numbers. If this suite passes, the machinery presumes no product — no
 * package-supplied actions, no package-supplied resources, no package-supplied
 * language.
 */
const VAULT = defineAuditVocabulary({
  actions: {
    'accession.register': { label: 'Accession registered' },
    'accession.withdraw': { label: 'Accession withdrawn' },
    'germination.record': { label: 'Germination trial recorded' },
    'vault.thaw': { label: 'Vault thaw logged' },
  },
  resources: {
    accession: {
      label: 'Accession',
      fields: ['taxon', 'gramsRemaining', 'vaultShelf', 'collectedOn'],
    },
    trial: { label: 'Germination trial', fields: ['viabilityPercent', 'seedsSown', 'protocol'] },
    vault: { label: 'Cold vault', fields: ['celsius', 'humidityPercent'] },
  },
});

const BANK = 'bank-svalbard';
const DENIAL = 'You may not read this seed bank trail.';

/** This package's own source root, for the import-hygiene case at the bottom. */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The bank's "database": an array, and the seam over it. */
function bankDb(): { db: AuditDb; rows: AuditLogCreateData[] } {
  const rows: AuditLogCreateData[] = [];
  const asRecord = (
    data: AuditLogCreateData,
    index: number,
  ): AuditLogRecord & { clientId: string } => ({
    ...data,
    id: `entry-${index}`,
    createdAt: new Date('2026-08-01T10:00:00Z'),
  });
  return {
    rows,
    db: {
      auditLog: {
        create({ data }) {
          rows.push(data);
          return Promise.resolve({});
        },
        findMany({ where, skip, take }) {
          return Promise.resolve(
            rows
              .map(asRecord)
              .filter((row) => row.clientId === where.clientId)
              .reverse()
              .slice(skip, skip + take),
          );
        },
        count({ where }) {
          return Promise.resolve(rows.filter((row) => row.clientId === where.clientId).length);
        },
      },
      $executeRawUnsafe: () => Promise.resolve(0),
    },
  };
}

/** Everything the bank has to write to adopt the package. */
function bankAudit(store = bankDb()) {
  const api = createApiAudit({
    db: () => Promise.resolve(store.db),
    resolveActor: () => ({
      tenantId: BANK,
      userId: 'curator-1',
      permissions: ['vault.trail.read'],
      role: 'CURATOR',
      scope: BANK,
    }),
    vocabulary: VAULT,
    trackedModels: ['Accession', 'Trial'],
    gatePermissions: { read: 'vault.trail.read' },
    messages: { forbidden: DENIAL },
    retention: { floorDays: 90, table: 'vault_audit_logs' },
    pagination: { defaultPageSize: 5, maxPageSize: 25, maxPage: 400 },
  });
  return { api, store };
}

type BankApi = ReturnType<typeof bankAudit>['api'];

const listRoute = (api: BankApi) => api.routes.find((route) => route.path === '/audit-logs');

const list = (api: BankApi, query: Record<string, string> = {}) =>
  listRoute(api)?.handle({ params: {}, query, header: () => undefined });

describe('a host that is not the one this package came from — writes', () => {
  it('writes an entry with the bank vocabulary and the bank actor', async () => {
    const { api, store } = bankAudit();

    await runWithActorScope(async () => {
      setActor('curator-1', { role: 'CURATOR', scope: BANK });
      await api.write(store.db, {
        clientId: BANK,
        action: 'accession.register',
        resourceType: 'accession',
        resourceId: 'ACC-19402',
        before: { gramsRemaining: 0 },
        after: { gramsRemaining: 420, taxon: 'Hordeum vulgare', donorPassportId: 'DO-NOT-LOG' },
      });
    });

    expect(store.rows[0]).toEqual({
      clientId: BANK,
      actorUserId: 'curator-1',
      actorRole: 'CURATOR',
      scope: BANK,
      onBehalfOfUserId: null,
      action: 'accession.register',
      resourceType: 'accession',
      resourceId: 'ACC-19402',
      before: { gramsRemaining: 0 },
      // Deny-by-default applies to the bank's allowlist exactly as it would to
      // anyone's: `donorPassportId` is not declared, so it never lands.
      after: { gramsRemaining: 420, taxon: 'Hordeum vulgare' },
      requestId: null,
    });
  });

  it('refuses an action the bank never declared', async () => {
    const { api, store } = bankAudit();

    await expect(
      api.write(store.db, {
        clientId: BANK,
        action: 'accession.incinerate',
        resourceType: 'accession',
        resourceId: 'ACC-19402',
      }),
    ).rejects.toThrow(/Unknown audit action "accession\.incinerate"/);
  });

  it('carries the impersonation pair with no host code at all', async () => {
    // The pair is a feature of the package, not of a host that happens to have
    // impersonation — so it works here, where nobody wired anything for it.
    const { api, store } = bankAudit();

    await runWithActorScope(async () => {
      setActor('registrar-9', { onBehalfOfUserId: 'curator-1' });
      await api.write(store.db, {
        clientId: BANK,
        action: 'vault.thaw',
        resourceType: 'vault',
        resourceId: 'VAULT-B',
      });
    });

    expect(store.rows[0]).toMatchObject({
      actorUserId: 'registrar-9',
      onBehalfOfUserId: 'curator-1',
    });
  });
});

describe('a host that is not the one this package came from — reads', () => {
  it('serves the bank trail under the bank gate permission', async () => {
    const { api, store } = bankAudit();
    await api.write(store.db, {
      clientId: BANK,
      action: 'germination.record',
      resourceType: 'trial',
      resourceId: 'TRIAL-7',
    });
    await api.write(store.db, {
      clientId: 'bank-elsewhere',
      action: 'germination.record',
      resourceType: 'trial',
      resourceId: 'not-mine',
    });

    const response = await list(api);

    expect(response?.status).toBe(200);
    expect((response?.body as { data: { resourceId: string }[] }).data).toHaveLength(1);
  });

  it('denies with the bank copy — no package language reaches a bank reader', async () => {
    const store = bankDb();
    const api = createApiAudit({
      db: () => Promise.resolve(store.db),
      resolveActor: () => ({ tenantId: BANK, userId: 'intern', permissions: [] }),
      vocabulary: VAULT,
      gatePermissions: { read: 'vault.trail.read' },
      messages: { forbidden: DENIAL },
    });

    const response = await list(api);

    expect(response).toEqual({ status: 403, body: { error: DENIAL } });
  });

  it('validates the bank filter values, and only those', async () => {
    const { api } = bankAudit();

    expect((await list(api, { action_in: 'vault.thaw' }))?.status).toBe(200);
    expect((await list(api, { action_in: 'accession.incinerate' }))?.status).toBe(400);
  });

  it('pages on the bank numbers, not on this package defaults', async () => {
    // The paging policy is config, and the whole of it travels: the default
    // size, the ceiling a request's size is clamped to, and the page ceiling.
    const { api, store } = bankAudit();
    for (const index of [1, 2, 3, 4, 5, 6, 7]) {
      await api.write(store.db, {
        clientId: BANK,
        action: 'germination.record',
        resourceType: 'trial',
        resourceId: `TRIAL-${index}`,
      });
    }

    const page = (await list(api))?.body as {
      data: unknown[];
      pagination: { pageSize: number };
    };
    const clamped = (await list(api, { pageSize: '900', page: '99999' }))?.body as {
      pagination: { pageSize: number; page: number };
    };

    expect(page.pagination.pageSize).toBe(5);
    expect(page.data).toHaveLength(5);
    expect(clamped.pagination).toMatchObject({ pageSize: 25, page: 400 });
  });
});

describe('a host that is not the one this package came from — the rest of the seam', () => {
  it('sweeps the bank table on the bank window', async () => {
    const store = bankDb();
    const statements: string[] = [];
    store.db.$executeRawUnsafe = (sql: string) => {
      statements.push(sql);
      return Promise.resolve(0);
    };
    const { api } = bankAudit(store);

    expect(api.retention.floorDays).toBe(90);
    await api.retention.purgeExpired();
    expect(statements[0]).toContain('"vault_audit_logs"');
  });

  it('stamps the bank models and guards this package own table, always', () => {
    const { api } = bankAudit();
    const applied: { name: string; models?: readonly string[] }[] = [];
    const client = {
      $extends(extension: unknown) {
        applied.push(extension as { name: string });
        return this;
      },
    };

    api.extendPrismaClient(client);

    expect(applied.map(({ name }) => name)).toEqual(['auditStamps', 'appendOnlyGuard']);
  });

  it('redacts against the bank allowlist through the exported core helper', () => {
    // The framework-free entry a surface with no database can import.
    expect(redactDiff(VAULT, 'vault', { celsius: -18, coordinates: '78.2N' })).toEqual({
      celsius: -18,
    });
    expect(VAULT.actionLabel('vault.thaw')).toBe('Vault thaw logged');
  });
});

describe('two hosts in one process', () => {
  /** A completely unrelated third vocabulary, mounted alongside the bank's. */
  const ferry = () =>
    defineAuditVocabulary({
      actions: { 'sailing.cancel': { label: 'Sailing cancelled' } },
      resources: { sailing: { label: 'Sailing', fields: ['berth', 'departsAt'] } },
    });

  it('do not see each other vocabulary', () => {
    // A package that quietly kept module-scope state would serve the first host
    // correctly and the second one somebody else's values.
    const FERRY = ferry();
    expect(VAULT.hasAction('sailing.cancel')).toBe(false);
    expect(FERRY.hasAction('vault.thaw')).toBe(false);
    expect(VAULT.hasResource('sailing')).toBe(false);
    expect(FERRY.hasResource('vault')).toBe(false);
  });

  it('keep their own allowlists, so one host diff cannot leak through another', () => {
    const FERRY = ferry();
    expect(() => redactDiff(FERRY, 'vault', { celsius: -18 })).toThrow(
      /Unknown audit resourceType/,
    );
    expect(redactDiff(FERRY, 'sailing', { berth: 'A3', celsius: -18 })).toEqual({ berth: 'A3' });
  });

  it('refuse the same assembly mistakes, independently', () => {
    expect(() =>
      defineAuditVocabulary({
        actions: { 'sailing.cancel': { label: 'Sailing cancelled' } },
        resources: { sailing: { label: 'Sailing', fields: [] } },
      }),
    ).toThrow(AuditConfigError);
  });
});

describe('the fixtures themselves', () => {
  /**
   * The anti-vacuity guard for the SUITE above: a portability proof written in
   * the extraction origin's own words proves nothing, and would look identical
   * to this file.
   *
   * It checks against `foreignPatterns()` — IMPORTED, not restated. A sibling
   * package's revision wrote its own regex covering eight of the sweep's
   * entries while claiming in a comment to use "the same one", which is two
   * statements of a set that can drift: precisely the defect this package now
   * exists to remove.
   */
  it('share no word with the application this package was extracted from', () => {
    const fixtureWords = [
      ...VAULT.actionIds,
      ...VAULT.resourceIds,
      ...VAULT.actionIds.map((id) => VAULT.actionLabel(id)),
      ...VAULT.resourceIds.map((id) => VAULT.resourceLabel(id)),
      BANK,
      DENIAL,
      'vault.trail.read',
      'vault_audit_logs',
      'Accession',
      'Trial',
      'CURATOR',
    ];

    const bans = foreignPatterns();
    for (const word of fixtureWords) {
      expect(bans.filter(({ pattern }) => new RegExp(pattern.source, 'i').test(word))).toEqual([]);
    }

    // Anti-vacuity for the guard itself: a loop over an empty list passes.
    expect(fixtureWords.length).toBeGreaterThan(15);
    // …and the list it checks against is the real one, with entries a
    // hand-written copy would have dropped.
    expect(bans.map(({ label }) => label)).toEqual(
      expect.arrayContaining(['R$', 'future-pay', 'comanda', 'Sistema', 'FUT-<n>']),
    );
    expect(bans.some(({ pattern }) => new RegExp(pattern.source, 'i').test('uma comanda'))).toBe(
      true,
    );
  });
});

/**
 * The packages the root + server halves must never reach, and the shapes a
 * specifier can name them in.
 *
 * SUBPATHS count (`hono/cookie`, `react/jsx-runtime`, `@12-apps/ui/foo`): a
 * subpath resolves the same package, so it fails a consumer's install for the same
 * reason the bare name does.
 *
 * TYPE-ONLY imports count too, DELIBERATELY — `import type { Context } from 'hono'`
 * is erased at runtime, but it is still an unavoidable `devDependency`/peer for
 * anyone type-checking against this package's published source, which is what this
 * package ships.
 */
const FORBIDDEN_PACKAGES = ['hono', 'react', 'react-dom', '@12-apps/ui'];

/**
 * The RELATIVE reach into a forbidden half, which is the hole this check had.
 *
 * The walk covers `index.ts` + `core/` + `server/` and matched a package name
 * against an exact-string list — so `server/foo.ts → '../react/labels'` passed
 * twice over: the specifier is not a package name, and the file it names is not in
 * the walked set, so nothing ever looked at ITS imports. That chain reaches
 * `@12-apps/ui` and `react` exactly as a direct import would.
 */
const FORBIDDEN_RELATIVE = /(?:^|\/)\.\.\/(react|hono)(?:\/|$)/;

/** Every module specifier in a source file, whatever quote or form it uses. */
function specifiersOf(source: string): string[] {
  const found: string[] = [];
  // `from '…'` / `from "…"`, bare `import '…'`, `import('…')` and `require('…')`.
  for (const match of source.matchAll(/(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g)) {
    if (match[1]) found.push(match[1]);
  }
  return found;
}

const isForbidden = (specifier: string): boolean =>
  FORBIDDEN_PACKAGES.some((name) => specifier === name || specifier.startsWith(`${name}/`)) ||
  FORBIDDEN_RELATIVE.test(specifier);

describe('the optional peers stay optional', () => {
  it('never imports hono or react from the root or the server half', () => {
    // `hono`, `react` and `react-dom` are OPTIONAL peers, and `@12-apps/ui` is a
    // dependency of the REACT half alone. A stray import here would make a host
    // that wants only the writer install a server framework and a design system —
    // the failure mode is an install-time resolution error in a consumer's tree,
    // which is exactly the class of bug the consumer harness exists for and the
    // one thing it cannot see, because it installs every package at once.
    const roots = ['index.ts', 'core', 'server'];
    const offenders: string[] = [];
    const walk = (relative: string): void => {
      const full = join(SRC, relative);
      if (statSync(full).isDirectory()) {
        for (const entry of readdirSync(full)) {
          if (entry === '__tests__') continue;
          walk(join(relative, entry));
        }
        return;
      }
      if (!full.endsWith('.ts') && !full.endsWith('.tsx')) return;
      for (const specifier of specifiersOf(readFileSync(full, 'utf-8'))) {
        if (isForbidden(specifier)) offenders.push(`${relative} → ${specifier}`);
      }
    };
    roots.forEach(walk);
    expect(offenders).toEqual([]);
  });

  it('catches the shapes the exact-string check used to miss', () => {
    // The check above passes on today's tree either way, so its STRENGTH is
    // asserted here rather than assumed: a subpath, a double-quoted specifier, a
    // type-only import and the relative hop through `../react` are each a real way
    // to pull an optional peer into the server half.
    const caught = [
      "import { Hono } from 'hono';",
      'import { getCookie } from "hono/cookie";',
      "import type { Context } from 'hono';",
      "import { Button } from '@12-apps/ui';",
      "import { jsx } from 'react/jsx-runtime';",
      "import { auditLabels } from '../react/labels';",
      "import { toAuditRequest } from '../../hono/index';",
      "const { Hono } = require('hono');",
    ].map((line) => specifiersOf(line).filter(isForbidden));

    expect(caught.every((hits) => hits.length === 1)).toBe(true);
    // …and the legitimate neighbours are NOT caught: `zod` is a hard dependency,
    // `node:async_hooks` is the platform, and the package's own halves are fine.
    const allowed = [
      "import { z } from 'zod';",
      "import { AsyncLocalStorage } from 'node:async_hooks';",
      "import { createApiAudit } from '../server/create-api-audit';",
      "import type { AuditVocabulary } from '../core/vocabulary';",
      // Not a reach into the react half — a file that happens to sit beside one.
      "import { labels } from '../reactive-labels';",
    ].map((line) => specifiersOf(line).filter(isForbidden));

    expect(allowed).toEqual([[], [], [], [], []]);
  });
});
