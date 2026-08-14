/**
 * Everything `@12-apps/impersonation` needs from a HOST, in one object.
 *
 * What is genuinely the host's, and all that is here: who is calling (a
 * header-driven session stand-in — a browser cannot have a real one), the
 * cipher the cookie is sealed with, which of this app's URLs are money and
 * which are somebody's own account, how long a session may last, what its
 * sentences say, and where the trail goes. Everything else — the codec's
 * refusals, the branch order of the write gate, the three verbs, the banner and
 * the dialog — is the package's, which is the entire claim under test.
 *
 * The vocabulary below is the harness's own (branches, borrowers, loans, fines),
 * and that is deliberate: a host whose words the package could have guessed
 * would prove nothing about whether it guesses.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

import { Hono } from 'hono';
import type { Context, MiddlewareHandler } from 'hono';

import { impersonationRouter } from '@12-apps/impersonation/hono';
import {
  IMPERSONATION_PERMISSIONS,
  type ImpersonationCodec,
  type ImpersonationTarget,
  type ImpersonationTenant,
} from '@12-apps/impersonation';
import {
  ImpersonationRefusedError,
  type ImpersonationActor,
  type ImpersonationAuditPort,
  type ImpersonationDirectory,
  type ImpersonationMessages,
  type ImpersonationStartEntry,
} from '@12-apps/impersonation/server';

import { RBAC_TENANT_B_ID, RBAC_TENANT_ID, RBAC_USERS } from './rbac-host';

/** Where the shared session surface is mounted. Read by the SPA too. */
export const IMPERSONATION_PLATFORM_PATH = '/api/desk-session';

/** The tenant preview mount, as a template the SPA rebuilds per branch. */
export const impersonationTenantPath = (slug: string): string =>
  `/api/admin/${slug}/desk-session`;

/** The branches a session may be bounded to. */
export const IMPERSONATION_TENANTS: readonly ImpersonationTenant[] = [
  { id: RBAC_TENANT_ID, slug: RBAC_TENANT_ID, name: 'North Branch' },
  { id: RBAC_TENANT_B_ID, slug: RBAC_TENANT_B_ID, name: 'Riverside Branch' },
];

/**
 * The two accounts that hold PLATFORM authority.
 *
 * Two, not one, because the refusal this whole mechanism is built around is a
 * start aimed at the second: a lateral move between full-privilege accounts
 * defeats attribution.
 */
export const SYSTEM_LIBRARIAN = {
  id: 'system-1',
  email: 'system@harness.dev',
  name: 'Sam Sistema',
};
export const SECOND_SYSTEM_LIBRARIAN = {
  id: 'system-2',
  email: 'system2@harness.dev',
  name: 'Robin Sistema',
};

const PLATFORM_IDS = new Set([SYSTEM_LIBRARIAN.id, SECOND_SYSTEM_LIBRARIAN.id]);

/** Everyone the directory can resolve: the roster, plus the two operators. */
const PEOPLE: readonly (ImpersonationTarget & { tenantId: string | null })[] = [
  ...RBAC_USERS.map((user) => ({
    id: user.id,
    email: user.email,
    name: user.name,
    isPlatformAdmin: false,
    tenantId: user.tenantId,
  })),
  { ...SYSTEM_LIBRARIAN, isPlatformAdmin: true, tenantId: null },
  { ...SECOND_SYSTEM_LIBRARIAN, isPlatformAdmin: true, tenantId: null },
];

const DIRECTORY = new Map(PEOPLE.map((person) => [person.id, person]));

/** The header a spec sets to act as someone else — the rbac host's convention. */
const ACTOR_HEADER = 'x-rbac-user';
/** Who the SPA is when it sets no header: a system librarian, who may start
 * operator sessions AND (through the platform short-circuit) previews. */
/** The header a spec sets to arrive as an integration key rather than a person. */
const MACHINE_HEADER = 'x-machine-token';

/**
 * An authenticated cipher, which is what the package asks a host for.
 *
 * AES-256-GCM: the authentication tag IS the signature check, so a payload that
 * was edited, truncated or minted under a different key fails to decrypt. A real
 * adopter passes whatever it already uses to round-trip values that must come
 * back untampered; the harness derives a key from a fixed passphrase because it
 * is a fixture and its cookies never outlive a run.
 */
function harnessCodec(): ImpersonationCodec {
  const key = scryptSync('harness-desk-sessions', 'harness-salt', 32);
  return {
    encrypt(plaintext) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const sealed = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return [iv, cipher.getAuthTag(), sealed]
        .map((part) => part.toString('base64url'))
        .join('.');
    },
    decrypt(ciphertext) {
      const [iv, tag, sealed] = ciphertext.split('.');
      if (!iv || !tag || !sealed) throw new Error('malformed');
      const decipher = createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(iv, 'base64url'),
      );
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(sealed, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    },
  };
}

/** The harness's own sentences. Nothing in the package supplies these. */
const MESSAGES: ImpersonationMessages = {
  machineTokenRefused: 'An integration key cannot open a desk session.',
  notAuthorized: 'Desk sessions are for library staff.',
  actorNotRecorded: 'Your staff record is incomplete, so nothing could be logged.',
  targetIsPlatformAdmin:
    'A system librarian may not be opened from the desk — the log could not say who did what.',
  targetNotFound: 'No such borrower.',
  notAMember: 'This person is not registered at this branch.',
  alreadyImpersonating: 'Close the open desk session before starting another.',
  tenantNotFound: 'No such branch.',
  invalidBody: 'The request could not be read.',
  readOnly: 'This desk session can only look, not change.',
  transactionBlocked: 'Loans and fines are never settled from a desk session.',
  accountBlocked: "A borrower's own details are theirs to change.",
  revoked: 'Desk sessions were switched off for this branch while yours was open.',
};

/** The trail, in memory — the harness's stand-in for an append-only table. */
export interface ImpersonationTrail {
  started: ImpersonationStartEntry[];
  ended: unknown[];
  refused: unknown[];
}

/** A denial the harness's own entitlement toggle raises. */
class BranchDeskSessionsOff extends Error {}

/** WHERE THE DATA LIVES — the roster, the branches, and the membership test. */
const DIRECTORY_PORT: ImpersonationDirectory = {
  findUser: async (id) => {
    const person = DIRECTORY.get(id);
    return person ? { id: person.id, email: person.email, name: person.name } : null;
  },
  resolveTarget: async (id) => {
    const person = DIRECTORY.get(id);
    if (!person) return null;
    return {
      id: person.id,
      email: person.email,
      name: person.name,
      isPlatformAdmin: PLATFORM_IDS.has(person.id),
    };
  },
  findTenant: async (id) => IMPERSONATION_TENANTS.find((tenant) => tenant.id === id) ?? null,
  findTenantBySlug: async (slug) =>
    IMPERSONATION_TENANTS.find((tenant) => tenant.slug === slug) ?? null,
  isActiveMember: async (userId, tenantId) => DIRECTORY.get(userId)?.tenantId === tenantId,
};

/**
 * WHO is calling — the one thing a host can never delegate.
 *
 * A header stand-in for a real session, the same shape the rbac host uses. The
 * package is handed a resolved actor and narrows against it; it never computes
 * one.
 */
function resolveActor(c: Context): ImpersonationActor {
  const id = c.req.header(ACTOR_HEADER) ?? SYSTEM_LIBRARIAN.id;
  const person = DIRECTORY.get(id);
  return {
    userId: person ? person.id : null,
    email: person?.email ?? `${id}@harness.dev`,
    isPlatformAdmin: PLATFORM_IDS.has(id),
    // Every staff row may open a preview here. A real host reads this off its
    // own RBAC engine.
    permissions: person && !PLATFORM_IDS.has(id) ? [IMPERSONATION_PERMISSIONS.preview] : [],
    isMachineToken: c.req.header(MACHINE_HEADER) === '1',
  };
}

/**
 * Is the real human behind an OPERATOR session still a system librarian?
 *
 * The revocation path. A real host re-reads its own allowlist; the harness reads
 * the same in-memory set, and `/__harness/impersonation/revoke` takes an id out
 * of it so a spec can watch a live session stop being one.
 */
const revoked = new Set<string>();

function stillAuthorized(
  state: { kind: string; realUserId: string },
  actor: ImpersonationActor,
): boolean {
  if (state.kind !== 'operator') return true;
  return !revoked.has(state.realUserId) && actor.isPlatformAdmin;
}

/**
 * WHERE THIS APP'S OWN SURFACES ARE — the four tables the write gate consults.
 *
 * The package has no idea, and a default here would be somebody else's URL
 * layout. The `moneyReads` entries are anchored to the whole pathname, so an
 * entry never carries its children in with it.
 */
const PATHS = {
  money: [/^\/api\/loans(\/|$)/, /^\/api\/fines(\/|$)/],
  moneyReads: [/^\/api\/loans$/, /^\/api\/fines$/],
  account: [/^\/api\/borrower-profile(\/|$)/],
  session: [
    new RegExp(`^${IMPERSONATION_PLATFORM_PATH}$`),
    /^\/api\/admin\/[^/]+\/desk-session$/,
  ],
};

export type HarnessImpersonation = ReturnType<typeof impersonationHost>;

export function impersonationHost() {
  const trail: ImpersonationTrail = { started: [], ended: [], refused: [] };
  /** Which branches currently allow desk sessions — the harness's own switch. */
  const entitled = new Set<string>(IMPERSONATION_TENANTS.map((tenant) => tenant.id));

  const audit: ImpersonationAuditPort = {
    started: async (entry) => void trail.started.push(entry),
    ended: async (entry) => void trail.ended.push(entry),
    refused: async (entry) => void trail.refused.push(entry),
  };

  const surface = impersonationRouter({
    cookieName: 'harness_desk_session',
    // The harness is served over plain HTTP; a real deploy answers `true`.
    secure: false,
    codec: harnessCodec(),
    // The library closes the desk after a shift, and a look is much shorter.
    timeBox: { operator: 30 * 60 * 1000, preview: 10 * 60 * 1000 },
    paths: PATHS,
    directory: DIRECTORY_PORT,
    audit,
    mintPolicy: {
      targetApps: ['counter', 'catalogue'],
      reasonLength: { min: 15, max: 280 },
    },
    previewPermission: IMPERSONATION_PERMISSIONS.preview,
    previewEntitlement: {
      require: async (tenantId) => {
        if (!entitled.has(tenantId)) throw new BranchDeskSessionsOff();
      },
      isDenial: (error) => error instanceof BranchDeskSessionsOff,
      denialResponse: () => ({
        status: 409,
        message: 'Desk sessions are switched off for this branch.',
      }),
    },
    messages: MESSAGES,
    stillAuthorized,
    resolveActor,
  });

  return {
    platform: surface.platform,
    tenant: surface.tenant,
    writeGate: writeGate(surface),
    trail,
    revoke(userId: string, value: boolean): void {
      if (value) revoked.add(userId);
      else revoked.delete(userId);
    },
    reset(): void {
      revoked.clear();
      trail.started.length = 0;
      trail.ended.length = 0;
      trail.refused.length = 0;
      entitled.clear();
      for (const tenant of IMPERSONATION_TENANTS) entitled.add(tenant.id);
    },
    setEntitled(tenantId: string, value: boolean): void {
      if (value) entitled.add(tenantId);
      else entitled.delete(tenantId);
    },
  };
}

/**
 * The per-request gate, as middleware — where a host puts it.
 *
 * In front of EVERY `/api` route and before any body is read, so a blocked route
 * answers the same 403 whatever the payload looks like and no handler side
 * effect can precede the check. It short-circuits on the cookie header, so
 * traffic that is not impersonated pays a substring test and nothing else.
 */
function writeGate(surface: ReturnType<typeof impersonationRouter>): MiddlewareHandler {
  return async (c, next) => {
    const cookie = readCookie(c, 'harness_desk_session');
    if (!cookie) return next();
    const impersonation = surface.readState({ actor: resolveActor(c), cookieValue: cookie });
    try {
      await surface.guard.assertAllowed({
        impersonation,
        pathname: new URL(c.req.url).pathname,
        method: c.req.method.toUpperCase(),
      });
    } catch (error) {
      if (!(error instanceof ImpersonationRefusedError)) throw error;
      return c.json({ error: error.message, code: error.code }, 403);
    }
    return next();
  };
}

/** One cookie off the raw header, tolerating a value that contains `=`. */
function readCookie(c: Context, name: string): string | undefined {
  const header = c.req.header('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const entry = part.trim();
    const eq = entry.indexOf('=');
    if (eq > 0 && entry.slice(0, eq) === name) return entry.slice(eq + 1);
  }
  return undefined;
}

/**
 * The HOST endpoints that stand behind the gate — the arrangement every guarded
 * route in a real app has, and the only way to see the refusals from a browser.
 *
 * Four shapes, deliberately: a money WRITE, an allowlisted money READ, an
 * unlisted money GET (the one where the verb lies), and an account write.
 */
export function mountImpersonationDemo(app: Hono, harness: HarnessImpersonation): void {
  app.get('/api/loans', (c) => c.json({ loans: [{ id: 'l-1', title: 'Dune' }] }));
  app.get('/api/loans/:id/receipt', (c) => c.json({ receipt: c.req.param('id') }));
  app.post('/api/loans/:id/renew', (c) => c.json({ renewed: c.req.param('id') }));
  app.post('/api/borrower-profile', (c) => c.json({ saved: true }));
  app.post('/api/catalog-notes', (c) => c.json({ saved: true }));

  // The host's OWN catalogs, which the dialog takes as config: the branches a
  // session may be bounded to, and who works at one.
  app.get('/__harness/impersonation/branches', (c) => c.json(IMPERSONATION_TENANTS));
  app.get('/__harness/impersonation/staff/:slug', (c) => {
    const slug = c.req.param('slug');
    const branch = IMPERSONATION_TENANTS.find((tenant) => tenant.slug === slug);
    return c.json(
      PEOPLE.filter((person) => person.tenantId === branch?.id).map((person) => person.id),
    );
  });

  app.get('/__harness/impersonation/trail', (c) => c.json(harness.trail));
  app.post('/__harness/impersonation/revoke', async (c) => {
    const body = (await c.req.json()) as { userId?: string; revoked?: boolean };
    harness.revoke(body.userId ?? SYSTEM_LIBRARIAN.id, body.revoked !== false);
    return c.body(null, 204);
  });
  app.post('/__harness/impersonation/entitlement', async (c) => {
    const body = (await c.req.json()) as { tenantId?: string; enabled?: boolean };
    harness.setEntitled(body.tenantId ?? RBAC_TENANT_ID, body.enabled !== false);
    return c.body(null, 204);
  });
}
