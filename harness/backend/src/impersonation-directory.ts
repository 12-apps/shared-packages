/**
 * WHO this harness's people are, and how a request names one.
 *
 * The roster, the two branches, the directory port the package reads them
 * through, and the actor resolution — split out of `impersonation-host.ts` for
 * the size gate, along the seam the file already had. Everything here answers
 * "who is calling and who may be called", which is the half a package can never
 * supply; the host file next door is the wiring.
 *
 * The vocabulary is the harness's own (branches, borrowers, librarians), and
 * that is deliberate: a host whose words the package could have guessed would
 * prove nothing about whether it guesses.
 */
import type { Context } from 'hono';

import {
  IMPERSONATION_PERMISSIONS,
  type ImpersonationTarget,
  type ImpersonationTenant,
} from '@12-apps/impersonation';
import type {
  ImpersonationActor,
  ImpersonationDirectory,
} from '@12-apps/impersonation/server';

import { RBAC_TENANT_B_ID, RBAC_TENANT_ID, RBAC_USERS } from './rbac-host';

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

export const PLATFORM_IDS = new Set([SYSTEM_LIBRARIAN.id, SECOND_SYSTEM_LIBRARIAN.id]);

/** Everyone the directory can resolve: the roster, plus the two operators. */
export const PEOPLE: readonly (ImpersonationTarget & { tenantId: string | null })[] = [
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


/** WHERE THE DATA LIVES — the roster, the branches, and the membership test. */
export const DIRECTORY_PORT: ImpersonationDirectory = {
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
export function resolveActor(c: Context): ImpersonationActor {
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
export const revoked = new Set<string>();

export function stillAuthorized(
  state: { kind: string; realUserId: string },
  actor: ImpersonationActor,
): boolean {
  if (state.kind !== 'operator') return true;
  return !revoked.has(state.realUserId) && actor.isPlatformAdmin;
}

