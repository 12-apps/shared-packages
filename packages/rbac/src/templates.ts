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
  // `impersonation:preview` (FUT-460) is an owner MARKER, not just an
  // unlisted permission. Leaving it merely absent from every template would
  // make it OWNER-only by accident: nothing would stop a tenant from composing
  // a custom role that holds it, and "Ver como" is the one grant that lets a
  // human read the admin through someone else's permissions. Listing it here
  // makes the restriction structural — `checkOwnerProtected` rejects an inline
  // custom role carrying it, and `checkCuratedMarkers` rejects injecting it
  // into a system template whose seed does not already have it (none does).
  // OWNER and SUPERADMIN are unaffected: they hold '*', which is a wildcard
  // marker `expandRole` short-circuits on, never an enumeration to extend.
  ownerPermissions: ['roles:manage', 'payouts:manage', 'impersonation:preview'],
  leafOnlyRoles: FUTURE_PAY_LEAF_ONLY_ROLES,
  sodPairs: FUTURE_PAY_SOD_PAIRS,
};
