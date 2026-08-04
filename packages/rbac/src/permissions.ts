/**
 * THE FUTURE PAY PERMISSION CATALOG — application DATA, not generic core.
 *
 * Split out of `templates.ts` (FUT-460) so that file stays what its own header
 * claims: the ROLE matrix. The two have always been separate concerns that
 * merely happened to share a file — the catalog is the vocabulary (which verbs
 * exist, and whether each is decided by RBAC alone), the templates are the
 * sentences (which roles say which verbs). They also change for different
 * reasons and at different rates: a new surface adds one catalog line and edits
 * several role arrays, and a re-cut of the role matrix touches no catalog line
 * at all. The seam existed; adding `impersonation:preview` to a 388-line file
 * with a 400-line ceiling is only what forced us to draw it.
 *
 * `templates.ts` re-exports both symbols, so every existing import path
 * (`@12-apps/rbac`, `../templates`) keeps working unchanged.
 *
 * Permission scope-kind: [C] class (RBAC alone decides), [I] instance (RBAC
 * gate THEN entity gate on ownership/assignment).
 */
import { definePermissions } from './core/registry';
import type { PermissionKind } from './core/types';

/**
 * The Future Pay permission registry (drives the typed permission union and the
 * class/instance scope-kind used by the default adapter's entity gate).
 */
export const FUTURE_PAY_PERMISSIONS = definePermissions({
  // Products
  'products:read:all': 'class',
  'products:read:published': 'instance',
  'products:write': 'class',
  'products:delete': 'class',
  // Entity-lifecycle approvals (@12-apps/entity-lifecycle): decide (apply/reject)
  // pending product change requests; actors WITHOUT it have their writes parked
  // for approval when the tenant's approvals feature is on. Mirrors
  // `purchasing:approve`.
  'products:approve': 'class',
  'categories:write': 'class',
  // Entity-lifecycle approvals (@12-apps/entity-lifecycle): decide (apply/reject)
  // pending category change requests; mirrors `products:approve`.
  'categories:approve': 'class',
  // Discounts & promotions (FUT-235). Read is granted separately from write so
  // "see which promos are running" is expressible without "change what the store
  // charges". There is no `discounts:approve`: a discount is a pricing rule with
  // a live redemption counter, not versioned catalog content, so it is
  // deliberately NOT plugged into @12-apps/entity-lifecycle — and with no approval
  // gate there is no author-cannot-approve pair to add to FUTURE_PAY_SOD_PAIRS.
  'discounts:read': 'class',
  'discounts:write': 'class',
  // Ingredients (insumos) — RAW/PREP stock products, granted separately from the
  // sellable catalog so "manage ingredients but not products" is expressible.
  'ingredients:read': 'class',
  'ingredients:write': 'class',
  'ingredients:delete': 'class',
  // Stock
  'stock:read': 'class',
  'stock:move': 'class',
  'stock:count': 'class',
  // Suppliers
  'suppliers:write': 'class',
  // Entity-lifecycle approvals (@12-apps/entity-lifecycle): decide (apply/reject)
  // pending supplier change requests; mirrors `products:approve`.
  'suppliers:approve': 'class',
  // Purchasing
  'purchasing:read:all': 'class',
  'purchasing:read:own': 'instance',
  'purchasing:write': 'class',
  'purchasing:approve': 'class',
  // Product research (FUT-390). Read is "see runs and ranked offers"; write
  // starts researches / configures sources (spends outbound calls and, later,
  // paid-API budget). No `research:approve`: a run produces information, not a
  // catalog/pricing change, so no lifecycle gate and no SoD pair.
  'research:read': 'class',
  'research:write': 'class',
  // Orders
  'orders:read:all': 'class',
  'orders:read:assigned': 'instance',
  'orders:read:own': 'instance',
  'orders:create': 'class',
  'orders:edit:assigned': 'instance',
  'orders:void': 'class',
  'orders:refund': 'class',
  // Tables
  'tables:read:all': 'class',
  'tables:read:assigned': 'instance',
  'tables:assign': 'class',
  'tables:manage': 'class',
  // Entity-lifecycle approvals (@12-apps/entity-lifecycle): decide (apply/reject)
  // pending mesa change requests; mirrors `products:approve`.
  'tables:approve': 'class',
  // Kitchen
  'kitchen:read:all': 'class',
  'kitchen:read:station': 'instance',
  'kitchen:update': 'class',
  // Kitchen stations (FUT-448): create/rename/reorder/retire the places dishes
  // are prepared. Split out of the blanket admin gate because a MANAGER runs the
  // floor — "the fryer is down, route nothing there tonight" is an operations
  // decision, not a config-owner one — while the rest of Configuração is not
  // theirs. Reading stations is NOT gated on it (the queue and the product form
  // both need the list).
  'kitchen-stations:manage': 'class',
  // Entity-lifecycle approvals (@12-apps/entity-lifecycle): decide (apply/reject)
  // pending kitchen-station change requests; mirrors `products:approve`.
  'kitchen-stations:approve': 'class',
  // Work shifts (FUT-446). `manage:own` is deliberately CLASS-scoped: the
  // package has no host actor model, so the host checks actor === target user.
  'shift:manage:own': 'class',
  'shift:read:all': 'class',
  'shift:end:any': 'class',
  // Payments
  'payments:take': 'class',
  // Reports
  'reports:sales:read': 'class',
  'reports:financial:read': 'class',
  // Cozinha analytics (FUT-454). Its OWN tier, deliberately not folded into
  // `reports:sales:read` and deliberately NOT held by CHEF: the reports carry
  // per-cook timings, and a cook must not be able to read the ranking they
  // appear in just because they can read the kitchen board.
  'reports:kitchen:read': 'class',
  // Audit trail viewer (FUT-152): read the tenant's append-only audit log.
  'audit:read': 'class',
  // Till
  'till:open': 'class',
  'till:close': 'class',
  // Payouts
  'payouts:manage': 'class',
  // Config
  'config:read': 'class',
  'config:write': 'class',
  // The STAFF-SAFE slice of the tenant's configuration (FUT-354): the
  // operational feature switches a service screen needs to decide whether it
  // exists at all (mesas on/off, comanda mode, order notes) — and NOTHING that
  // makes `config:read` an admin grant (address, coordinates, costing method,
  // lifecycle/plan state). It is a SEPARATE key rather than a widening of
  // `config:read` precisely so granting a cook "can you see whether this store
  // runs comandas" never grants "can you read where this store is".
  //
  // Read surfaces take it as a TIER alongside `config:read` (any-of), the same
  // shape the LIST reads use, so an ADMIN who already holds the wide read needs
  // no second grant.
  'config:read:operational': 'class',
  // Entity-lifecycle approvals (@12-apps/entity-lifecycle): decide (apply/reject)
  // pending stock-location change requests; mirrors `products:approve`. Location
  // config writes are admin-gated (no dedicated write permission), so there is no
  // author-cannot-approve SoD pair — only this decider grant.
  'stock-locations:approve': 'class',
  // Entity-lifecycle approvals (@12-apps/entity-lifecycle): decide (apply/reject)
  // pending loss-reason change requests; mirrors `products:approve`. Reason config
  // writes are admin-gated (no dedicated write permission), so there is no
  // author-cannot-approve SoD pair — only this decider grant.
  'loss-reasons:approve': 'class',
  // Team
  'team:read': 'class',
  'team:manage': 'class',
  // Roles admin
  'roles:manage': 'class',
  // Entity-lifecycle approvals (@12-apps/entity-lifecycle): decide (apply/reject)
  // pending custom-role change requests; mirrors `products:approve`.
  'roles:approve': 'class',
  // "Ver como" (FUT-460): open a read-only preview of the admin as one of the
  // tenant's own roles, or as one of its own team members.
  //
  // CLASS, not instance, and the distinction is the whole point of the grant.
  // What is being gated is ENTERING a preview at all — a capability of the
  // actor, decided before any target exists. It is NOT "may preview THIS
  // member", which would be an instance decision needing a resource assignment
  // per colleague, a table nobody writes. The target is not policed by RBAC at
  // this seam because it does not need to be: the preview session applies a
  // never-widen INTERSECTION ceiling against the actor's own permission set, so
  // previewing a colleague can only ever show LESS than the actor already sees.
  // The grant answers "may you look through someone else's eyes"; the ceiling
  // answers "how far can you see while doing it".
  //
  // Owner-only in practice — see DEFAULT_ROLE_TEMPLATES in `./templates`, where
  // it is deliberately absent from ADMIN's enumeration.
  'impersonation:preview': 'class',
} as const satisfies Record<string, PermissionKind>);

/** Permission union derived from the Future Pay registry. */
export type FuturePayPermission =
  (typeof FUTURE_PAY_PERMISSIONS.list)[number];
