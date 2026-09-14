/**
 * The config a frontend host hands `createWebRbac` — its own file because it IS
 * the adoption contract.
 *
 * It lives apart from `create-web-rbac.tsx` for the reason that file's own size
 * gate keeps insisting on: the surface is a few hundred lines of wiring, and
 * the config is a few hundred lines of ARGUMENT about what a host owns. Reading
 * either one to change the other has never been necessary, and keeping them in
 * one file meant every new seam pushed the wiring closer to a limit that has
 * nothing to do with it.
 */
import type { RbacCatalog } from '../core/compose';
import type { RbacCopySource } from '../core/copy';
import type { RbacLabelVocabulary } from '../core/contribution';

import type { RbacWebCopy } from './copy';
import type { MemberScreenProps } from './member-screen';
import type { RoleMenuContext } from './role-actions-menu';
import type { RoleSeedDefault } from './role-grid-config';
import type { RolesScreenProps } from './roles-screen';
import type { TeamExtraColumn } from './team-grid-config';
import type { RoleModel } from './team-role-dialog';
import type { RbacTransport } from './transport';

/** Which language the permission and role LABELS read in — the host's hook. */
export type RbacLocaleHook = () => string | null | undefined;

export interface RbacWebConfig<P extends string = string> {
  /** The admin mount the routes live under, e.g. `/api/admin/minha-loja`. */
  apiBase: string;
  /** The tenant these screens act inside. See {@link RolesScreenProps.tenantSlug}. */
  tenantSlug: string;
  /**
   * The host's composed catalog — registry, role templates, governance and the
   * merged labels, as ONE object. It used to be three optional fields
   * defaulting to a catalog this package shipped, which meant a host could
   * pass its own registry and silently keep somebody else's governance.
   */
  catalog: RbacCatalog<P>;
  /**
   * Every sentence the screens render — REQUIRED, the host's words.
   * pt-BR hosts pass `PT_BR_RBAC_WEB_COPY` from `./pt-BR` (re-exported at
   * `@12-apps/rbac/react`).
   */
  copy: RbacWebCopy;
  /** How the surface reaches its data. Default: same-origin fetch. */
  transport?: RbacTransport;
  /**
   * The host's multi-select surface for the roles grid.
   *
   * Optional, and absent it changes nothing. See
   * {@link RolesScreenProps.bulkSlot} for why it is a component rather than a
   * list of actions.
   */
  rolesBulkSlot?: RolesScreenProps['bulkSlot'];
  /**
   * Label overrides layered over the catalog's own — a vocabulary, or a
   * RESOLVER over a tag-keyed pack.
   *
   * These are the host's last word on a segment, so they must be able to follow
   * a reader for the same reason the catalog's can: an override that stayed
   * frozen would be the ONE word on the screen still in the old language, which
   * reads as a bug rather than as a setting.
   */
  labels?: RbacCopySource<RbacLabelVocabulary>;
  /**
   * Gate permission ids, when the host's catalog spells them differently.
   *
   * `readRoles` alone has no default: unset, `manageRoles` decides both
   * seeing and editing, which is right for a host whose roles are editable
   * rows. See {@link RolesScreenProps.readPermission}.
   */
  gatePermissions?: { manageRoles?: string; manageTeam?: string; readRoles?: string };
  /** See {@link TeamScreenProps.defaultInviteRole}. */
  defaultInviteRole?: string;
  /** See {@link RoleModel}. Defaults to `base+custom`. */
  roleModel?: RoleModel;
  /** Roster columns this package cannot build — {@link TeamExtraColumn}. */
  teamExtraColumns?: readonly TeamExtraColumn[];
  /** Which ⋮ entries the roster offers, by id. Absent, all of them. */
  teamRowActionIds?: readonly string[];
  /** The host's own section on a member's details tab. */
  renderMemberExtra?: MemberScreenProps['renderExtra'];
  /**
   * The seed defaults a seeded role is compared against to decide whether it has
   * been EDITED away from the catalog. Absent, no row ever reads as edited and
   * the reset affordance never appears — the safe direction, and the honest one
   * for a host that materialises its roles some other way.
   */
  roleSeeds?: ReadonlyMap<string, RoleSeedDefault>;
  /**
   * How the two dates on a member's profile are formatted.
   *
   * REQUIRED, and required rather than defaulted for two separate reasons. A
   * date's presentation is a locale decision the host owns, so an
   * `Intl.DateTimeFormat` in here would pick one for every adopter. And
   * `manifest/web` DECLARES the member screen as an area route: a config that
   * could leave it unbuilt would leave a host projecting that row a nav entry
   * resolving to `undefined`, with the wiring report saying everything is fine
   * — the exact silent hole `manifest/__tests__/web.test.ts` exists to close.
   */
  formatters: MemberScreenProps['formatters'];
  /** The crumbs above each screen's title. The host owns its own hierarchy. */
  breadcrumbs?: {
    roles?: readonly { label: string; href?: string }[];
    team?: readonly { label: string; href?: string }[];
    /** The crumbs BEFORE the member's own name, which the screen appends. */
    member?: readonly { label: string; href?: string }[];
  };
  /** Row-click destinations, when the host routes the screen they open. */
  navigate?: {
    /** Open one member's profile from the roster. */
    member?: (userId: string) => void;
    /** Show who holds a role, from the catalog. */
    roleMembers?: (roleName: string) => void;
  };
  /** See {@link RoleMenuContext.renderVersionHistory}. */
  renderVersionHistory?: RoleMenuContext['renderVersionHistory'];
  /**
   * Which language the permission and role LABELS read in — the host's own
   * hook, called inside the renders that show one.
   *
   * A hook rather than a tag because this surface is built ONCE, in a
   * `useMemo` keyed on the tenant: its members are component TYPES, so
   * rebuilding it per render remounts the whole tree below and the role form
   * could not be typed into. A tag passed here would therefore be the language
   * that was true when the tenant was last switched.
   *
   * It is CONFIG rather than a dependency for the reason every seam in this
   * package is: `@12-apps/rbac` must stay liftable into a repo that has never
   * heard of `@12-apps/i18n`. A host on it passes `useLocale`; a host with one
   * audience passes nothing and gets the words its catalog contributed.
   *
   * `copy` is deliberately NOT paired with this. Those sentences are already an
   * ordinary value the host hands over per surface, so a host that resolves
   * them with `useLocaleCopy` has always been able to; the labels could not,
   * because they arrive inside a catalog composed once for the whole process.
   */
  useLocale?: RbacLocaleHook;
}
