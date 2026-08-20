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
 * Most answers already had one. `RoleRecord`, `RoleListRecord`,
 * `TeamMemberDetail` and `TeamMemberRecord` are the stores' own return types and
 * are exported from `./index`, so a host can bind to them today. This module is
 * for the answers the package assembles AT THE ROUTE, which belong to no store
 * and so had no published shape.
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
