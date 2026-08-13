/* eslint-disable test-flakiness/no-test-isolation, test-flakiness/no-unmocked-fs --
   `api` is a const built by `blogAudit()` inside each case over its own array;
   the heuristic reads the name as shared state. The filesystem read at the bottom
   IS the subject: the last case walks this package's own source to prove the
   optional peers are never imported from the root or the server half. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { indexVocabulary, redactDiff, type AuditVocabulary } from '../index';
import { runWithActorScope, setActor } from '../server/actor-context';
import { createApiAudit } from '../server/create-api-audit';
import type { AuditDb, AuditLogCreateData, AuditLogRecord } from '../server/db';

/**
 * The TOY SECOND HOST (12-14 acceptance): a complete "blog" wired to this package
 * with ONLY a vocabulary, an actor resolver and a db seam — zero imports from the
 * Future Pay vocabulary, and zero code the blog had to write to make the surface
 * work. If this suite passes, the machinery presumes no restaurants: no
 * `order.cancel`, no `MenuItem`, no `audit:read`, no pt-BR.
 *
 * The rbac package's `portability.test.ts` is the precedent, and the reason both
 * exist: "generic" is a claim, and a second host is the only thing that checks it.
 */
const BLOG_VOCABULARY: AuditVocabulary = {
  actions: [
    { id: 'post.publish', label: 'Post published' },
    { id: 'post.retract', label: 'Post retracted' },
    { id: 'comment.hide', label: 'Comment hidden' },
  ],
  resources: [
    { id: 'post', label: 'Post', fields: ['title', 'state', 'publishedAt'] },
    { id: 'comment', label: 'Comment', fields: ['state', 'reason'] },
  ],
};

const SITE = 'site-cooking';

/** This package's own source root, for the import-hygiene case at the bottom. */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The blog's "database": an array, and the seam over it. */
function blogDb(): { db: AuditDb; rows: AuditLogCreateData[] } {
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
        findMany({ where }) {
          return Promise.resolve(
            rows
              .map(asRecord)
              .filter((row) => row.clientId === where.clientId)
              .reverse(),
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

/** Everything the blog has to write to adopt the package. */
function blogAudit(store = blogDb()) {
  const api = createApiAudit({
    db: () => Promise.resolve(store.db),
    resolveActor: () => ({
      tenantId: SITE,
      userId: 'alice',
      permissions: ['trail.read'],
      role: 'EDITOR',
      scope: SITE,
    }),
    vocabulary: BLOG_VOCABULARY,
    trackedModels: ['Post', 'Comment'],
    gatePermissions: { read: 'trail.read' },
    messages: { forbidden: 'You cannot read this site trail.' },
    retention: { floorDays: 90, table: 'blog_audit_logs' },
  });
  return { api, store };
}

describe('toy second host — the write path', () => {
  it('writes an entry with the blog vocabulary and the blog actor', async () => {
    const { api, store } = blogAudit();

    await runWithActorScope(async () => {
      setActor('alice', { role: 'EDITOR', scope: SITE });
      await api.write(store.db, {
        clientId: SITE,
        action: 'post.publish',
        resourceType: 'post',
        resourceId: 'post-1',
        before: { state: 'DRAFT' },
        after: { state: 'LIVE', title: 'Sourdough', secretDraftNotes: 'do not ship' },
      });
    });

    expect(store.rows[0]).toEqual({
      clientId: SITE,
      actorUserId: 'alice',
      actorRole: 'EDITOR',
      scope: SITE,
      onBehalfOfUserId: null,
      action: 'post.publish',
      resourceType: 'post',
      resourceId: 'post-1',
      before: { state: 'DRAFT' },
      // Deny-by-default applies to the blog's allowlist exactly as it did to the
      // restaurant's: `secretDraftNotes` is not declared, so it never lands.
      after: { state: 'LIVE', title: 'Sourdough' },
      requestId: null,
    });
  });

  it('refuses a restaurant action — the vocabulary is the blog', async () => {
    const { api, store } = blogAudit();

    await expect(
      api.write(store.db, {
        clientId: SITE,
        action: 'order.cancel',
        resourceType: 'post',
        resourceId: 'post-1',
      }),
    ).rejects.toThrow(/Unknown audit action "order\.cancel"/);
  });

  it('carries the impersonation pair with no host code at all', async () => {
    // The property ticket 12-24 builds on: the pair is a feature of the package,
    // not of the host that happens to have impersonation.
    const { api, store } = blogAudit();

    await runWithActorScope(async () => {
      setActor('support', { onBehalfOfUserId: 'alice' });
      await api.write(store.db, {
        clientId: SITE,
        action: 'comment.hide',
        resourceType: 'comment',
        resourceId: 'c-1',
      });
    });

    expect(store.rows[0]).toMatchObject({
      actorUserId: 'support',
      onBehalfOfUserId: 'alice',
    });
  });
});

describe('toy second host — the read surface', () => {
  it('serves the blog trail under the blog gate permission', async () => {
    const { api, store } = blogAudit();
    await api.write(store.db, {
      clientId: SITE,
      action: 'post.publish',
      resourceType: 'post',
      resourceId: 'post-1',
    });
    await api.write(store.db, {
      clientId: 'site-other',
      action: 'post.publish',
      resourceType: 'post',
      resourceId: 'not-mine',
    });

    const route = api.routes.find((candidate) => candidate.path === '/audit-logs');
    const response = await route?.handle({ params: {}, query: {}, header: () => undefined });

    expect(response?.status).toBe(200);
    expect((response?.body as { data: { resourceId: string }[] }).data).toHaveLength(1);
  });

  it('denies with the blog copy — nothing pt-BR reaches a blog reader', async () => {
    const store = blogDb();
    const api = createApiAudit({
      db: () => Promise.resolve(store.db),
      resolveActor: () => ({ tenantId: SITE, userId: 'bob', permissions: [] }),
      vocabulary: BLOG_VOCABULARY,
      gatePermissions: { read: 'trail.read' },
      messages: { forbidden: 'You cannot read this site trail.' },
    });

    const route = api.routes.find((candidate) => candidate.path === '/audit-logs');
    const response = await route?.handle({ params: {}, query: {}, header: () => undefined });

    expect(response).toEqual({
      status: 403,
      body: { error: 'You cannot read this site trail.' },
    });
  });

  it('validates the blog filter values, and only those', async () => {
    const { api } = blogAudit();
    const route = api.routes.find((candidate) => candidate.path === '/audit-logs');

    const blogAction = await route?.handle({
      params: {},
      query: { action_in: 'post.publish' },
      header: () => undefined,
    });
    const foreignAction = await route?.handle({
      params: {},
      query: { action_in: 'order.cancel' },
      header: () => undefined,
    });

    expect(blogAction?.status).toBe(200);
    expect(foreignAction?.status).toBe(400);
  });
});

describe('toy second host — the rest of the seam', () => {
  it('sweeps the blog table on the blog window', async () => {
    const store = blogDb();
    const statements: string[] = [];
    store.db.$executeRawUnsafe = (sql: string) => {
      statements.push(sql);
      return Promise.resolve(0);
    };
    const { api } = blogAudit(store);

    expect(api.retention.floorDays).toBe(90);
    await api.retention.purgeExpired();
    expect(statements[0]).toContain('"blog_audit_logs"');
  });

  it('stamps the blog models, and leaves the vocabulary out of it', async () => {
    const { api } = blogAudit();
    const applied: string[] = [];
    const client = {
      $extends(extension: unknown) {
        applied.push((extension as { name: string }).name);
        return this;
      },
    };

    api.extendPrismaClient(client);

    expect(applied).toEqual(['auditStamps', 'appendOnlyGuard']);
  });

  it('redacts against the blog allowlist through the exported core helper', () => {
    // The framework-free entry a blog surface with no database can import.
    const index = indexVocabulary(BLOG_VOCABULARY);
    expect(redactDiff(index, 'comment', { state: 'HIDDEN', ip: '1.2.3.4' })).toEqual({
      state: 'HIDDEN',
    });
    expect(index.actionLabel('post.retract')).toBe('Post retracted');
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
 * package ships. (Before, they were caught only by accident: the old regex matched
 * the `from` clause and never looked at what preceded it.)
 */
const FORBIDDEN_PACKAGES = ['hono', 'react', 'react-dom', '@12-apps/ui'];

/**
 * The RELATIVE reach into a forbidden half, which is the hole this check had.
 *
 * The walk covers `index.ts` + `core/` + `server/` and matched a package name
 * against an exact-string list — so `server/foo.ts → '../react/labels'` passed
 * twice over: the specifier is not a package name, and the file it names is not in
 * the walked set, so nothing ever looked at ITS imports. That chain reaches
 * `@12-apps/ui` and `react` exactly as a direct import would; a transitive
 * resolution would be the thorough fix, and forbidding the one-hop specifier is
 * the cheap one that closes the reachable case.
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
