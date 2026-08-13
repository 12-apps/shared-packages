/**
 * DEFAULT ROLE TEMPLATES — application DATA, not generic core.
 *
 * These are Future Pay's concrete roles and governance policy, shipped as
 * JSON-serializable data so the generic core stays app-agnostic. A different
 * host would define its own and never import this file; that is the whole point
 * of keeping templates separate from `core/`.
 *
 * The permission CATALOG this matrix draws on lives next door in
 * `./permissions` (FUT-460 split it out to keep both files under the size
 * gate). It is re-exported from here so `@12-apps/rbac` and every `../templates`
 * import keeps resolving exactly as before — the split is invisible to callers.
 */
import type { RoleDef } from './core/types';
import type { GovernanceCatalog } from './governance';
import {
  FUTURE_PAY_PERMISSIONS,
  type FuturePayPermission,
} from './permissions';

export { FUTURE_PAY_PERMISSIONS } from './permissions';
export type { FuturePayPermission } from './permissions';


/** Default, portable role templates for Future Pay (FUT-146 role matrix). */
export const DEFAULT_ROLE_TEMPLATES: readonly RoleDef<FuturePayPermission>[] = [
  {
    name: 'OWNER',
    permissions: '*',
    description: 'Full access within a tenant.',
  },
  {
    name: 'ADMIN',
    permissions: [
      'products:read:all',
      'products:write',
      'products:delete',
      'products:approve',
      'ingredients:read',
      'ingredients:write',
      'ingredients:delete',
      'categories:write',
      'categories:approve',
      'discounts:read',
      'discounts:write',
      'stock:read',
      'stock:move',
      'stock:count',
      'suppliers:write',
      'suppliers:approve',
      'purchasing:read:all',
      'purchasing:write',
      'purchasing:approve',
      'research:read',
      'research:write',
      'orders:read:all',
      'orders:create',
      'orders:void',
      'orders:refund',
      'tables:read:all',
      'tables:assign',
      'tables:manage',
      'tables:approve',
      'kitchen:read:all',
      'kitchen:update',
      'kitchen-stations:manage',
      'kitchen-stations:approve',
      'payments:take',
      'reports:sales:read',
      'reports:financial:read',
      // ADMIN enumerates every non-owner-only capability and there is no wider
      // reports tier to inherit from, so the kitchen tier is listed explicitly
      // (FUT-454) — without it an ADMIN cannot open Cozinha › Análise at all.
      'reports:kitchen:read',
      'audit:read',
      'till:open',
      'till:close',
      'payouts:manage',
      'config:read',
      'config:write',
      'stock-locations:approve',
      'loss-reasons:approve',
      'team:read',
      'team:manage',
      'roles:manage',
      'roles:approve',
      // "Ver como", both halves (FUT-460). An ADMIN configures the store's roles
      // and its people, so an ADMIN is who needs to check the result — this used
      // to be an owner marker they could not hold or be granted, which left the
      // one person doing the work unable to verify it. Safe by the same property
      // the feature has always turned on: a preview resolves the INTERSECTION
      // with the previewer's own set, so an admin previewing an owner sees an
      // admin's screen.
      'user:impersonate',
      'user:impersonate:configure',
    ],
    description: 'Administers a tenant; everything except owner-only actions.',
  },
  {
    name: 'MANAGER',
    permissions: [
      'products:read:all',
      'products:write',
      'ingredients:read',
      'ingredients:write',
      'categories:write',
      'discounts:read',
      'discounts:write',
      'stock:read',
      'stock:move',
      'stock:count',
      'suppliers:write',
      'purchasing:read:all',
      'purchasing:write',
      'research:read',
      'research:write',
      'orders:read:all',
      'orders:create',
      'orders:void',
      'tables:read:all',
      'tables:assign',
      'tables:manage',
      'kitchen:read:all',
      // A manager must be able to UNBLOCK kitchen work (FUT-354): a line stuck
      // on an absent cook is theirs to move. Who may move WHICH line — the
      // open-shift/station ownership rule — is decided transactionally with the
      // mutation in FUT-447; this grant only says the manager is in scope at all.
      'kitchen:update',
      'kitchen-stations:manage',
      'payments:take',
      'shift:read:all',
      'shift:end:any',
      'reports:sales:read',
      'reports:kitchen:read',
      'till:open',
      'till:close',
      'team:read',
      'config:read:operational',
    ],
    description: 'Runs day-to-day operations for a single restaurant.',
  },
  {
    name: 'WAITER',
    permissions: [
      'products:read:all',
      'ingredients:read',
      'orders:read:assigned',
      'orders:create',
      'orders:edit:assigned',
      'tables:read:assigned',
      'payments:take',
      'shift:manage:own',
      // Without it the Mesas screen cannot even learn that this store HAS
      // mesas — the flag lives in the tenant config, which is an admin read.
      'config:read:operational',
    ],
    description: 'Takes and serves orders on assigned tables.',
  },
  {
    name: 'CHEF',
    permissions: [
      'products:read:all',
      'ingredients:read',
      'stock:read',
      'kitchen:read:station',
      'kitchen:update',
      'shift:manage:own',
      // Cozinha only exists in comanda mode, and that is a config flag: without
      // this the cook's own screen resolves to "off" for want of a read.
      'config:read:operational',
    ],
    description: 'Works the kitchen station queue.',
  },
  {
    name: 'FINANCIAL',
    permissions: [
      'reports:sales:read',
      'reports:financial:read',
      'orders:refund',
      'payouts:manage',
      'till:close',
    ],
    description: 'Financial oversight, refunds and payouts.',
  },
  {
    name: 'BUYER',
    permissions: [
      'products:read:all',
      'ingredients:read',
      'suppliers:write',
      'stock:read',
      'stock:count',
      'purchasing:read:own',
      'purchasing:write',
      'research:read',
      'research:write',
    ],
    description: 'Manages purchasing and supplier relationships.',
  },
  {
    name: 'SUPERADMIN',
    permissions: '*',
    description:
      'Platform-wide access; intended to be assigned at GLOBAL scope.',
  },
] as const;

/**
 * CLIENT is a POPULATION capability set, NOT a staff role assignment. It
 * describes what an ordinary logged-in customer of the storefront can do; the
 * host applies it by capability, never via a role assignment on the team.
 */
export const CLIENT_CAPABILITIES: readonly FuturePayPermission[] = [
  'products:read:published',
  'orders:read:own',
  'orders:create',
] as const;

/**
 * Separation-of-duties pairs — a single custom role may hold NEITHER both. A
 * buyer who writes a purchase order must not also approve it.
 */
export const FUTURE_PAY_SOD_PAIRS: readonly (readonly [
  FuturePayPermission,
  FuturePayPermission,
])[] = [
  ['purchasing:write', 'purchasing:approve'],
  // The author of a product change must not also approve it (custom roles).
  ['products:write', 'products:approve'],
  // Same author-cannot-approve rule for category changes.
  ['categories:write', 'categories:approve'],
  // Same author-cannot-approve rule for supplier changes.
  ['suppliers:write', 'suppliers:approve'],
  // Same author-cannot-approve rule for mesa changes (`tables:manage` writes).
  ['tables:manage', 'tables:approve'],
  // Same author-cannot-approve rule for kitchen-station changes (FUT-448).
  ['kitchen-stations:manage', 'kitchen-stations:approve'],
  // Same author-cannot-approve rule for custom-role changes.
  ['roles:manage', 'roles:approve'],
] as const;

/**
 * Roles that may only be assigned at a LEAF scope (a single restaurant), never
 * at an org/parent scope.
 */
export const FUTURE_PAY_LEAF_ONLY_ROLES: readonly string[] = [
  'MANAGER',
  'WAITER',
  'CHEF',
] as const;

/**
 * Template roles that are PLATFORM-only — assigned at GLOBAL scope, never a
 * per-tenant staff role — and so never surface on a tenant's roles admin
 * (FUT-217). SUPERADMIN is the lone platform role; every other template
 * (OWNER…BUYER) is a per-tenant staff role listed and, except OWNER, editable.
 */
export const FUTURE_PAY_PLATFORM_ONLY_ROLES: readonly string[] = [
  'SUPERADMIN',
] as const;

/**
 * The governance catalog passed to `validateGrant`. Bundles the registry, the
 * roles, owner-protection markers, leaf-only roles and the SoD pairs.
 */
export const FUTURE_PAY_GOVERNANCE: GovernanceCatalog = {
  permissions: FUTURE_PAY_PERMISSIONS,
  roles: DEFAULT_ROLE_TEMPLATES,
  ownerRoles: ['OWNER', 'SUPERADMIN'],
  // THE "Ver como" GRANTS ARE DELIBERATELY NOT HERE (FUT-460).
  //
  // `impersonation:preview` — now `user:impersonate` — shipped as an owner
  // MARKER on this list, which made the restriction structural:
  // `checkOwnerProtected` rejected any inline custom role carrying it, and
  // `checkCuratedMarkers` rejected injecting it into a system template. The
  // effect was that "Ver como" could not be delegated AT ALL, to anyone, ever —
  // not to the administrator who configures the store's roles, not through a
  // custom role a store composed for exactly that purpose. The one person doing
  // the permissions work was the one person who could not check it.
  //
  // What made it feel dangerous is handled elsewhere and always was: a preview
  // resolves the INTERSECTION of the previewed subject's set with the
  // previewer's own, so this grant can never widen anybody. Marking it here
  // protected nothing that the ceiling does not, and cost the feature its
  // audience. `roles:manage` and `payouts:manage` stay: those DO widen — one
  // hands out permissions, the other moves money.
  ownerPermissions: ['roles:manage', 'payouts:manage'],
  leafOnlyRoles: FUTURE_PAY_LEAF_ONLY_ROLES,
  sodPairs: FUTURE_PAY_SOD_PAIRS,
};
