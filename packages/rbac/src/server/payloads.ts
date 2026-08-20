/**
 * What the mounted routes ANSWER (12-13) — the response half of the contract.
 *
 * `wire.ts` beside this file holds the REQUEST half, and only that half: six
 * `*Body` schemas and the param/query parsers. It used to claim a surface built
 * on it "can never drift", which named the one direction that could not break
 * while the other did — a host's advertised `getMyPermissions` listed
 * `permissions` alone while `GET /permissions` had been merging
 * `permissionsExtras` into the answer for as long as the option existed
 * (FUT-760). Nothing could have caught it: there was no type to disagree with.
 *
 * Some answers already had one. Three routes return a store's record UNCHANGED,
 * and those records are exported from `./index`, so a host can bind to them
 * today:
 *
 *   GET  /roles                      RoleListRecord[]   (paged)
 *   POST /roles, PATCH /roles/:id    RoleRecord
 *   PUT  /roles/templates/:name      RoleRecord
 *   GET  /team                       TeamMemberRecord[] (paged)
 *
 * This module is for the rest — the answers the package assembles AT THE ROUTE,
 * which belong to no store and so had no published shape. There are two, and the
 * second is a trap worth naming: `GET /team/:userId` does NOT answer
 * `TeamMemberDetail`. It answers a PROJECTION of it, and a host that bound its
 * schema to the record would be forced to advertise two fields the route does
 * not send.
 *
 * Its own module rather than more of `context.ts`, which sits near the 400-line
 * ceiling the complexity gate enforces — and because a response contract is a
 * thing a host reads deliberately, not something to find among the config types.
 */

/**
 * What `GET /permissions` answers — the payload behind a host's shell read.
 *
 * A host holds its advertised schema to this:
 *
 * ```ts
 * const myPermissionsSchema = z.object({ ... })
 *   satisfies z.ZodType<MyPermissionsPayload<MyExtras>>;
 * ```
 *
 * `E` is whatever `RbacServerConfig.permissionsExtras` resolves to, merged at
 * the TOP level beside `permissions` rather than nested under a key. It defaults
 * to `Record<string, unknown>`, so a host that merges nothing — or has not yet
 * named its extras — is unaffected.
 */
export type MyPermissionsPayload<E extends Record<string, unknown> = Record<string, unknown>> = {
  /** The caller's OWN resolved ids, sorted — Set iteration is insertion-defined. */
  permissions: string[];
} & E;

/**
 * What `GET /team/:userId` answers — NOT `TeamMemberDetail`, which is the store's
 * row.
 *
 * Two deliberate differences, and both are why this type has to exist
 * separately:
 *
 *  - `active` and `status` are DROPPED. The detail read is the profile page; a
 *    membership's enabled state is the roster's column and the status route's
 *    business, and answering it here would be a second place to read it from.
 *  - `memberSince` and `lastLoginAt` are ISO STRINGS, not `Date`. They cross a
 *    wire, and `Date` does not — `JSON.stringify` would produce the same string
 *    while the TYPE went on claiming a `Date` no caller ever receives.
 *
 * A host binds its advertised schema to this rather than to the record:
 *
 * ```ts
 * const teamMemberDetailSchema = z.object({ ... })
 *   satisfies z.ZodType<MemberDetailPayload>;
 * ```
 */
export interface MemberDetailPayload {
  userId: string;
  name: string | null;
  email: string;
  image: string | null;
  role: string;
  /** The member's additive custom-role grants, by name. */
  customRoles: string[];
  /** ISO timestamp of when the user joined this store's roster. */
  memberSince: string;
  /** ISO timestamp of the last successful sign-in, or null if never recorded. */
  lastLoginAt: string | null;
}
