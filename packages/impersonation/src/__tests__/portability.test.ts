import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IMPERSONATION_PERMISSIONS } from '../core/permissions';
import type { ImpersonationBannerState } from '../core/types';
// The two published barrels, as namespaces, for the export-surface case at the
// foot of this file. STATIC on purpose — see the comment there.
import * as reactEntry from '../react/index';
import * as serverEntry from '../server/index';
import { createApiImpersonation } from '../server/create-api-impersonation';
import type {
  ImpersonationActor,
  ImpersonationMessages,
  ImpersonationResponse,
} from '../server/context';
import { impersonationHeadline, type ImpersonationBannerLabels } from '../react/labels';

import { createTestAudit, createTestDirectory, memberKey, testCodec } from './fixtures';

/**
 * THE TOY SECOND HOST, and the tripwire that the package itself carries none of
 * anybody's product.
 *
 * The suite below mounts this package for a library-lending application: its
 * money paths are loans and fines, its "tenant" is a branch, its apps are the
 * counter and the public catalogue, and every sentence it shows is in words no
 * other product would use. If this compiles and passes, nothing in the package
 * presumes one application's URLs, vocabulary or language.
 *
 * THAT ALONE PROVES LESS THAN IT LOOKS LIKE IT DOES, which is why the last block
 * exists. "Zero imports from the extracted application" is a discipline a suite
 * keeps by choosing its own imports; it says nothing about what the published
 * tarball CONTAINS. A package can pass a portability suite and still ship
 * another product's permission catalog, its label maps, or its ticket numbers —
 * and a second host installing it would receive all of them. The final block
 * asserts against the FILES rather than against this file's imports.
 */

/* ── the library's own vocabulary — nothing here is shared with any host ── */

const LIBRARY_MESSAGES: ImpersonationMessages = {
  machineTokenRefused: 'An integration key cannot open a desk session.',
  notAuthorized: 'Desk sessions are for library staff.',
  actorNotRecorded: 'Your staff record is incomplete, so nothing could be logged.',
  targetIsPlatformAdmin: 'A system librarian may not be opened from the desk.',
  targetNotFound: 'No such borrower.',
  notAMember: 'This person is not registered at this branch.',
  alreadyImpersonating: 'Close the open desk session first.',
  tenantNotFound: 'No such branch.',
  invalidBody: 'The request could not be read.',
  readOnly: 'This desk session can only look, not change.',
  transactionBlocked: 'Loans and fines are never settled from a desk session.',
  accountBlocked: "A borrower's own details are theirs to change.",
  revoked: 'Desk sessions were switched off for this branch.',
};

const LIBRARY_LABELS: ImpersonationBannerLabels = {
  regionLabel: 'Desk session',
  actingAs: ({ subject, tenant }) =>
    tenant ? `At the desk as ${subject} (${tenant})` : `At the desk as ${subject}`,
  previewingRole: ({ role }) => `Looking as a ${role}`,
  previewingMember: ({ subject }) => `Looking as ${subject}`,
  unknownSubject: 'someone',
  readOnly: 'Look only',
  remaining: ({ formatted }) => `Closes in ${formatted}`,
  expired: 'The desk session has closed',
  timeUp: 'Time is up',
  unconfirmed: 'Could not confirm the desk session',
  exitFailed: 'Could not close it. Try again.',
  exit: 'Close the desk session',
};

const BRANCH = { id: 'branch-north', slug: 'north', name: 'North Branch' };

function mountLibrary() {
  const { directory, state } = createTestDirectory();
  const { audit, trail } = createTestAudit();

  state.tenants.set(BRANCH.id, BRANCH);
  state.users.set('librarian', {
    id: 'librarian',
    email: 'librarian@library.test',
    name: 'Lee',
    isPlatformAdmin: true,
  });
  state.users.set('borrower', {
    id: 'borrower',
    email: 'borrower@library.test',
    name: 'Ada',
    isPlatformAdmin: false,
  });
  state.memberships.add(memberKey('borrower', BRANCH.id));

  const api = createApiImpersonation({
    cookieName: 'lib_desk_session',
    secure: true,
    codec: testCodec('library'),
    // The library closes the desk after a shift, not after half an hour.
    timeBox: { operator: 4 * 60 * 60 * 1000, preview: 5 * 60 * 1000 },
    paths: {
      money: [/^\/api\/loans(\/|$)/, /^\/api\/fines(\/|$)/],
      moneyReads: [/^\/api\/loans$/, /^\/api\/fines$/],
      account: [/^\/api\/borrower-profile(\/|$)/],
      session: [/^\/desk\/session$/, /^\/branches\/[^/]+\/desk\/session$/],
    },
    directory,
    audit,
    mintPolicy: {
      targetApps: ['counter', 'catalogue'],
      reasonLength: { min: 8, max: 400 },
    },
    // The library spells its permissions in its own words, and never adopts
    // this package's recommendation.
    previewPermission: 'desk:look-as',
    messages: LIBRARY_MESSAGES,
  });

  return { api, state, trail };
}

const librarian: ImpersonationActor = {
  userId: 'librarian',
  email: 'librarian@library.test',
  isPlatformAdmin: true,
  permissions: [],
  isMachineToken: false,
};

type LibraryApi = ReturnType<typeof mountLibrary>['api'];

function drive(
  mounted: LibraryApi,
  method: 'GET' | 'POST' | 'DELETE',
  surface: 'platform' | 'tenant',
  request: Partial<Parameters<LibraryApi['routes'][number]['handle']>[0]> = {},
): Promise<ImpersonationResponse> {
  const endpoint = mounted.routes.find((r) => r.method === method && r.surface === surface);
  if (!endpoint) throw new Error(`no ${method} on ${surface}`);
  return endpoint.handle({
    actor: request.actor ?? librarian,
    params: request.params ?? {},
    body: request.body,
    cookieValue: request.cookieValue,
  });
}

/** A fixed clock, so the four-hour desk window is an exact assertion. */
const NOW = Date.parse('2026-05-01T09:00:00.000Z');

describe('a second host, in a vocabulary this package has never heard of', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts a desk session against the library\'s own branches and apps', async () => {
    const { api: library, trail } = mountLibrary();
    const response = await drive(library, 'POST', 'platform', {
      body: {
        targetUserId: 'borrower',
        targetApp: 'counter',
        tenantId: BRANCH.id,
        reason: 'card reported not scanning',
      },
    });

    expect(response.status).toBe(200);
    expect((response.body as { data: ImpersonationBannerState }).data).toMatchObject({
      active: true,
      kind: 'operator',
      tenant: { slug: 'north' },
    });
    expect(trail.started).toHaveLength(1);
  });

  it('honours the library\'s own time box, not one this package chose', async () => {
    const { api: library } = mountLibrary();
    const response = await drive(library, 'POST', 'platform', {
      body: {
        targetUserId: 'borrower',
        targetApp: 'counter',
        tenantId: BRANCH.id,
        reason: 'card reported not scanning',
      },
    });
    const data = (response.body as { data: ImpersonationBannerState }).data;
    expect(Date.parse(data.expiresAt ?? '')).toBe(NOW + 4 * 60 * 60 * 1000);
  });

  it('gates the preview on the library\'s OWN permission id', async () => {
    const { api: library } = mountLibrary();
    const staff: ImpersonationActor = {
      userId: 'clerk',
      email: 'clerk@library.test',
      isPlatformAdmin: false,
      permissions: ['desk:look-as'],
      isMachineToken: false,
    };
    await expect(
      drive(library, 'POST', 'tenant', {
        actor: staff,
        params: { tenantSlug: 'north' },
        body: { as: 'role', roleName: 'PAGE' },
      }),
    ).resolves.toMatchObject({ status: 200 });

    // The id this package RECOMMENDS grants nothing here, because the library
    // never adopted it.
    await expect(
      drive(library, 'POST', 'tenant', {
        actor: { ...staff, permissions: [IMPERSONATION_PERMISSIONS.preview] },
        params: { tenantSlug: 'north' },
        body: { as: 'role', roleName: 'PAGE' },
      }),
    ).rejects.toMatchObject({ message: LIBRARY_MESSAGES.notAuthorized });
  });

  it('refuses the library\'s money paths, in the library\'s own words', async () => {
    const { api: library } = mountLibrary();
    const started = await drive(library, 'POST', 'platform', {
      body: {
        targetUserId: 'borrower',
        targetApp: 'counter',
        tenantId: BRANCH.id,
        reason: 'card reported not scanning',
      },
    });
    const impersonation = library.readState({
      actor: librarian,
      cookieValue: started.cookie?.value,
    });

    await expect(
      library.guard.assertAllowed({
        impersonation,
        pathname: '/api/fines/f-1/waive',
        method: 'POST',
      }),
    ).rejects.toMatchObject({ message: LIBRARY_MESSAGES.transactionBlocked });

    // …and the desk stays closable, at the URL the LIBRARY mounted it on.
    await expect(
      library.guard.assertAllowed({
        impersonation,
        pathname: '/branches/north/desk/session',
        method: 'DELETE',
      }),
    ).resolves.toBeUndefined();
  });

  it('renders the banner headline in the library\'s sentences', () => {
    const operator: ImpersonationBannerState = {
      active: true,
      kind: 'operator',
      readOnly: true,
      expiresAt: new Date(NOW).toISOString(),
      previewRoleName: null,
      subject: { id: 'borrower', email: 'borrower@library.test', name: 'Ada' },
      tenant: BRANCH,
    };
    expect(impersonationHeadline(operator, LIBRARY_LABELS)).toBe(
      'At the desk as Ada (North Branch)',
    );
    expect(
      impersonationHeadline(
        { ...operator, kind: 'preview', previewRoleName: 'PAGE' },
        LIBRARY_LABELS,
      ),
    ).toBe('Looking as a PAGE');
    expect(
      impersonationHeadline(
        { ...operator, kind: 'preview', previewRoleName: null, subject: null },
        LIBRARY_LABELS,
      ),
    ).toBe('Looking as someone');
  });
});

/* ── the tripwire: what the PACKAGE ships, not what this suite imports ──── */

const SOURCE_ROOT = fileURLToPath(new URL('..', import.meta.url));
/** The package root — `features/` and the docs ship too, and are exactly where a
 * product name survives a `src/`-only scan. */
const PACKAGE_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/**
 * Every file that actually SHIPS.
 *
 * `__tests__` is excluded because the manifest's `files` list excludes it — the
 * question is what a consumer installs, and a suite naming the forbidden
 * patterns in order to forbid them would otherwise fail itself.
 */
function sourceFiles(directory: string): string[] {
  // Reading the real tree is the ENTIRE point of the block below: the claim is
  // about what the published tarball contains, and a mocked filesystem would
  // assert only what this file put in it.
  // eslint-disable-next-line test-flakiness/no-unmocked-fs
  return readdirSync(directory).flatMap((entry) => {
    if (entry === '__tests__') return [];
    const full = join(directory, entry);
    // eslint-disable-next-line test-flakiness/no-unmocked-fs
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(tsx?|md|feature)$/.test(entry) ? [full] : [];
  });
}

/** Every published directory, per the manifest's `files`. */
function shippedFiles(): string[] {
  return [
    ...sourceFiles(SOURCE_ROOT),
    ...sourceFiles(join(PACKAGE_ROOT, 'features')),
    join(PACKAGE_ROOT, 'README.md'),
    join(PACKAGE_ROOT, 'ADOPTING.md'),
  ];
}

function offendingLines(pattern: RegExp): string[] {
  return shippedFiles().flatMap((file) =>
    // eslint-disable-next-line test-flakiness/no-unmocked-fs
    readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((line, index) =>
        pattern.test(line)
          ? [`${file.slice(PACKAGE_ROOT.length)}:${index + 1}: ${line.trim()}`]
          : [],
      ),
  );
}

describe('the package knows which product it serves: it does not', () => {
  it('names no product, anywhere in its source', () => {
    // The one-command check, run as an assertion so it cannot be forgotten.
    expect(offendingLines(/future[\s_-]?pay|paladira/i)).toEqual([]);
  });

  it('carries no ticket ids from the application it was extracted from', () => {
    // A ticket number is a host's issue tracker leaking into a library's source:
    // meaningless to every other consumer, and a standing invitation to write
    // the next one down too. Published standards are spelled the same way and
    // are not that, so they are named out rather than matched.
    expect(
      offendingLines(/\b(?!ISO|RFC|UTF|SHA|AES|GCM|HTTP|UTC)[A-Z]{2,5}-\d{2,6}\b/),
    ).toEqual([]);
  });

  it('ships no product COPY — a label map is by definition somebody\'s language', () => {
    // Accented Latin letters are the cheapest reliable signal that a sentence
    // meant for a user has been written down here rather than taken as config.
    // Every string this package puts on a screen arrives through `labels`.
    expect(offendingLines(/[àáâãäçèéêëìíîïòóôõöùúûü]/i)).toEqual([]);
  });

  it('declares only the permissions guarding its OWN surface', () => {
    // ONE id, because this package ships exactly one gated route. The tenant's
    // own consent switch is the HOST's screen and the host's catalog entry.
    expect(Object.values(IMPERSONATION_PERMISSIONS)).toEqual(['user:impersonate']);
    const domains = new Set(
      Object.values(IMPERSONATION_PERMISSIONS).map((id) => id.split(':')[0]),
    );
    expect([...domains]).toEqual(['user']);
  });

  it('exports no default messages or labels for a host to inherit by accident', () => {
    // A default fails OPEN for a second host: it silently adopts another
    // product's vocabulary instead of failing loudly at compile time.
    //
    // The barrels are imported STATICALLY at the top of this file rather than
    // with `await import(...)` here. `../react/index` pulls the whole component
    // tree — `@12-apps/ui`, MUI, emotion — and a dynamic import charges Vite's
    // transform of that graph to the TEST's 5s budget instead of to collection.
    // Alone that is ~1s and passes; in a full `turbo run test` across thirty
    // packages it is ~7s and times out, so this suite went red only on main
    // (where the push lane runs the whole workspace) and stayed green on the PR
    // that introduced it. Nothing here is testing lazy loading — the subject is
    // the export surface, and a static import measures it just as well.
    const exported = [...Object.keys(serverEntry), ...Object.keys(reactEntry)];
    expect(exported.filter((name) => /^DEFAULT_/.test(name))).toEqual([]);
  });
});
