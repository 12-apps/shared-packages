/**
 * THIS PACKAGE'S OWN PERMISSION CONTRIBUTION.
 *
 * `@12-apps/rbac` ships screens and endpoints of its own — the roles catalog
 * and its compose/edit dialog, the team roster, the template-override
 * governance — so it owns the permissions that guard them, and exports them
 * the same way any other package exports its contribution. Three ids, and
 * they are the three already named in `DEFAULT_GATE_PERMISSIONS`: everything
 * this surface gates, it gates with one of these.
 *
 * WHAT USED TO BE HERE, and why it left (12-13 follow-up): a 61-id catalog of
 * Future Pay's products, orders, mesas, kitchen, stock and payments, plus that
 * host's eight role templates and its governance policy — under a header that
 * called itself "application DATA, not generic core" while sitting inside the
 * package every other host installs. A permission belongs to whoever owns the
 * surface it guards; `products:write` guards no screen in here. So the domain
 * catalog moved to the host, the approval grants (`products:approve`,
 * `categories:approve`, …) are queued to move to `@12-apps/entity-lifecycle`,
 * and the host assembles the whole thing with `composePermissions` — which is
 * also how it gets these three, rather than by this package assuming them.
 *
 * A host may still spell them differently: `gatePermissions` on the server
 * config and the web config maps each surface onto whatever id its own
 * catalog uses. The contribution below is the default, not a requirement.
 */
import {
  definePermissionContribution,
  type PermissionOf,
} from './core/contribution';

/** The permissions guarding this package's own screens and endpoints. */
export const RBAC_PERMISSIONS = definePermissionContribution({
  source: '@12-apps/rbac',
  permissions: {
    /**
     * Role CRUD, per-tenant template overrides, and the additive grant/revoke
     * of a custom role on a member.
     *
     * An OWNER MARKER, and the one policy claim this package makes about its
     * own ids for every host: a role that hands out permissions is owner-level
     * power, so it is never composable into an inline custom role and never
     * injectable into a template override that its seed did not already carry.
     * Escalation alone would not cover it — that guard asks whether the granter
     * holds the permission, not whether handing it on is delegation of the
     * granting power itself.
     */
    'roles:manage': { kind: 'class', ownerMarker: true },
    /**
     * The roster and member-detail reads. CLASS: what is gated is reaching the
     * team surface at all, decided before any member is named. Row-level reach
     * is the tenant boundary's job, not an entity gate's.
     */
    'team:read': { kind: 'class' },
    /** Member base-role set, enable/disable, invite cancel. */
    'team:manage': { kind: 'class' },
  },
  /**
   * pt-BR, matching `DEFAULT_MESSAGES` and the tab labels the screens already
   * ship — and overridable per host, the same way those are. Only the segments
   * THESE three ids use: a host's own vocabulary arrives with its own
   * contribution, and an unlabelled segment still renders as its raw text.
   */
  labels: {
    domains: { roles: 'Papéis', team: 'Equipe' },
    actions: { read: 'Ver', manage: 'Gerenciar' },
  },
});

/** The permission union this package contributes. */
export type RbacPermission = PermissionOf<typeof RBAC_PERMISSIONS>;
