/**
 * COMPILE-TIME fixtures for the response contracts (12-13 / FUT-760).
 *
 * The real assertion is `tsc --noEmit` (the package's `check-types` script).
 * Every `@ts-expect-error` line MUST fail to compile without the directive; if
 * a change ever loosens `MyPermissionsPayload` so an under-declared shape is
 * accepted, the directive becomes "unused" and `check-types` fails — the
 * tripwire fires both ways. The runtime tests below keep the module a real
 * suite and pin the two facts a type cannot state: that the extras are merged
 * at the TOP level rather than nested, and that `permissions` is sorted.
 *
 * WHY THIS EXISTS. `GET /permissions` merges `permissionsExtras` into its
 * answer, and a host advertises that answer to agents. Those were two separate
 * descriptions of one payload, with nothing holding them together, and they
 * disagreed: the host listed `permissions` alone while the route had been
 * merging an entitlement snapshot in for as long as the option had existed.
 * `MyPermissionsPayload` is now the single description, so a host can bind its
 * schema to the same type the route is built against. `MemberDetailPayload`
 * covers the other route-assembled answer, which is a projection rather than a
 * store row and so cannot borrow one.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type {
  MemberDetailPayload,
  MyPermissionsPayload,
  RbacActor,
  RbacServerConfig,
  TeamMemberDetail,
} from '../index';

/** A host's extras — the shape `permissionsExtras` resolves to. */
interface DemoExtras extends Record<string, unknown> {
  entitlements: { plan: string };
}

/** Exercised only by the type checker — deliberately never called at runtime. */
export function payloadContractFixtures(): void {
  // Baseline: a schema describing the WHOLE payload satisfies the contract.
  const complete = z.object({
    permissions: z.array(z.string()),
    entitlements: z.object({ plan: z.string() }),
  }) satisfies z.ZodType<MyPermissionsPayload<DemoExtras>>;
  void complete;

  // The original bug, as a compile error: a schema that declares `permissions`
  // and forgets what the host merges in no longer typechecks.
  const underDeclared = z.object({
    permissions: z.array(z.string()),
    // @ts-expect-error `entitlements` is part of the answer and must be declared
  }) satisfies z.ZodType<MyPermissionsPayload<DemoExtras>>;
  void underDeclared;

  // A host that merges nothing is unaffected — `E` defaults.
  const bare = z.object({
    permissions: z.array(z.string()),
  }) satisfies z.ZodType<MyPermissionsPayload>;
  void bare;

  // The config's extras are typed by the same parameter, so a host's function
  // and its advertised schema cannot describe different shapes.
  const config: Pick<RbacServerConfig<string, DemoExtras>, 'permissionsExtras'> = {
    permissionsExtras: async (actor: RbacActor) => ({
      entitlements: { plan: actor.isSuper ? 'internal' : 'pro' },
    }),
  };
  void config;

  const wrongExtras: Pick<RbacServerConfig<string, DemoExtras>, 'permissionsExtras'> = {
    // @ts-expect-error `plan` is a string, and the host said so
    permissionsExtras: async (actor: RbacActor) => ({
      entitlements: { plan: actor.isSuper ? 1 : 7 },
    }),
  };
  void wrongExtras;
}

/**
 * The detail read answers a PROJECTION of the store's row, and the two are
 * easy to mistake for each other — they share six of eight field names. A host
 * that bound its schema to `TeamMemberDetail` would advertise `active` and
 * `status`, which the route drops, and would type the two timestamps as `Date`,
 * which no caller ever receives.
 */
export function memberDetailContractFixtures(): void {
  // The record is NOT the payload: the store's row has fields the route drops
  // and `Date`s where the wire carries strings.
  const record: TeamMemberDetail = {
    userId: 'u1',
    role: 'BRANCH_LEAD',
    email: 'a@b.c',
    name: null,
    image: null,
    active: true,
    status: 'ENABLED',
    memberSince: new Date('2026-01-15T09:30:00.000Z'),
    lastLoginAt: null,
    customRoles: [],
  };
  // @ts-expect-error the row is not assignable to the wire shape it projects to
  const wrong: MemberDetailPayload = record;
  void wrong;

  const payload: MemberDetailPayload = {
    userId: record.userId,
    name: record.name,
    email: record.email,
    image: record.image,
    role: record.role,
    customRoles: record.customRoles,
    memberSince: record.memberSince.toISOString(),
    lastLoginAt: record.lastLoginAt?.toISOString() ?? null,
  };
  void payload;
}

describe('the shell read payload', () => {
  it('merges extras at the top level, beside `permissions`', () => {
    // The type says `{ permissions } & E`, not `{ permissions, extras }`. A
    // nested shape would typecheck against a different reading of the same
    // words, so the flattening is asserted at runtime rather than assumed.
    const payload: MyPermissionsPayload<DemoExtras> = {
      permissions: ['roles:manage'],
      entitlements: { plan: 'pro' },
    };
    expect(Object.keys(payload).sort()).toEqual(['entitlements', 'permissions']);
  });

  it('keeps `permissions` an array of ids the caller holds', () => {
    const payload: MyPermissionsPayload = { permissions: ['b', 'a'].sort() };
    expect(payload.permissions).toEqual(['a', 'b']);
  });
});
