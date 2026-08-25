import type { ConfirmActionCopy } from '@12-apps/ui/copy';
import type { DataViewsCopy } from '@12-apps/ui/data-display/DataViews';

/**
 * Every sentence the roles + team admin renders — REQUIRED host config, with
 * NO defaults (the copy-portability doctrine): two screens, their tables,
 * dialogs and the row menu compiled in ~50 pt-BR strings a host could not
 * reach, so every adopter shipped one product's voice with nothing red. A
 * pt-BR host imports {@link PT_BR_RBAC_WEB_COPY} from `./pt-BR` (re-exported
 * at `@12-apps/rbac/react`) and passes it by hand — one reviewable line,
 * never a silence.
 *
 * Facts travel as ARGUMENTS (a role name, a member's name, a count), so a
 * translation can put them where its own grammar wants them.
 */

/**
 * The picker's words for THIS package's own permission segments. Every other
 * segment's words arrive with the contribution that owns the ids they label
 * (`catalog.labels`); these are the words for `roles:manage` / `team:read` /
 * `team:manage`, the three ids this package contributes — which is why they
 * live in the copy port rather than in the contribution, where they used to
 * be one application's pt-BR shipped to every adopter.
 */
export interface PermissionLabelsCopy {
  /** The picker's group headings for the two domains this package's ids live under. */
  domains: { roles: string; team: string };
  /** The verb segments those three ids use. */
  actions: { read: string; manage: string };
}

export interface RolesListCopy {
  title: string;
  newRoleAction: string;
  searchPlaceholder: string;
  loadFailed: string;
  /** The load error's retry affordance. */
  retryAction: string;
  /** The header explainer, over the catalog. */
  aboutTitle: string;
  aboutBody: string;
  /** The grid's empty state. */
  emptyState: string;
  /**
   * What an actor without the manage gate sees INSTEAD of the screen.
   *
   * A neutral not-found rather than a refusal, mirroring what the endpoints
   * answer: "you may not" and "there is nothing here" are the same sentence on
   * purpose, so the screen reveals no more than the API does.
   */
  forbiddenTitle: string;
  forbiddenBody: string;
  /** The compose/edit dialog's title, per mode. */
  dialogTitles: {
    create: string;
    edit: (name: string) => string;
    override: (name: string) => string;
  };
  deleteConfirm: { title: string; body: string; confirmLabel: string };
  resetConfirm: { title: string; body: string; confirmLabel: string };
  /** The confirm step's back-out. */
  cancelAction: string;
}

export interface RolesTableCopy {
  headers: { name: string; description: string; kind: string; permissions: string; actions: string };
  /**
   * The chip naming a row's kind. `systemEdited` is a seeded role whose
   * effective permissions or description have drifted from the catalog seed —
   * the state `resetAction` exists to undo, and the only one a reader can act on.
   */
  kinds: { system: string; systemEdited: string; custom: string };
  /** The single "kind" filter facet, and its two option labels. */
  kindFilter: string;
  /** The permission count of a wildcard (`'*'`) role. */
  allPermissions: string;
  /** The unit under the count on a role card ("permissions"). */
  permissionsUnit: string;
  /** A role with no description at all, on the card's secondary line. */
  noDescription: string;
  /** Whether the row may be edited at all, and its two values. */
  editableLabel: string;
  editableYes: string;
  /** A locked (owner-tier) role — never editable. */
  lockedLabel: string;
  /** The card's permission list when the role grants none. */
  noPermissions: string;
  /** A field with nothing to show. */
  emptyValue: string;
  editAction: string;
  resetAction: string;
  deleteAction: string;
  /** The version-history entry, shown only when the host wires the slot. */
  historyAction: string;
  /** What a failed delete says when the server sent no sentence of its own. */
  deleteFailed: string;
  /** What a failed reset says, for the same reason. */
  resetFailed: string;
}

export interface RoleFormCopy {
  /** The name field's placeholder AND accessible label. */
  nameLabel: string;
  descriptionPlaceholder: string;
  /** The description field's accessible label. */
  descriptionLabel: string;
  /** "Permissões (N selecionadas)" — the pack owns the pluralisation. */
  selectionCount: (count: number) => string;
  /** The per-permission scope-kind badge. */
  kinds: { class: string; instance: string };
  cancelAction: string;
  /** The submit when editing an existing role. */
  saveAction: string;
  /** The submit when composing a new one. */
  createAction: string;
}

export interface TeamScreenCopy {
  title: string;
  searchPlaceholder: string;
  loadFailed: string;
  /** The load error's retry affordance. */
  retryAction: string;
  /** The header explainer, over the roster. */
  aboutTitle: string;
  aboutBody: string;
  /** The header's "add administrator" button, and the dialog it opens. */
  inviteAction: string;
  inviteDialogTitle: string;
  /** The e-mail field's label, and the sentence under it. */
  inviteEmailLabel: string;
  inviteHint: string;
  /** The success banner shown when a grant was DEFERRED to the person's signup. */
  inviteDeferredTitle: string;
  inviteDeferredBody: string;
  /** The banner over a failed roster mutation. */
  errorTitle: string;
  /** The grid's empty state. */
  emptyState: string;
  /** The export's file stem — no extension; the format appends its own. */
  exportFileName: string;
  removeConfirm: { title: string; body: string; confirmLabel: string };
  /** Cancelling a pending invite. `cancelLabel` is the popup's BACK-OUT, which
   *  cannot also read "cancel" when the action itself is a cancellation. */
  cancelInviteConfirm: {
    title: string;
    body: string;
    confirmLabel: string;
    cancelLabel: string;
    failed: string;
  };
  /** What a failed removal says when the server sent no sentence of its own. */
  removeFailed: string;
  /** The confirm step's back-out. */
  cancelAction: string;
}

export interface TeamTableCopy {
  headers: { name: string; email: string; roles: string; status: string };
  /** The three roster row states — a pending invite is neither active nor off. */
  status: { active: string; disabled: string; pending: string };
  /** The two filter facets over the roster. */
  filters: { roles: string; status: string };
  /** The export's column headers, in order. */
  exportHeaders: { name: string; email: string; role: string; customRoles: string; status: string };
}

/**
 * The per-member profile (`/team/:userId`) — a tabbed read-only view of one
 * person's access.
 *
 * The three tabs beyond the first are PLACEHOLDERS in the origin host and stay
 * placeholders here: they are named so a host can decide whether to offer them
 * at all ({@link MemberProfileCopy.tabs} is the whole list), and
 * {@link MemberProfileCopy.comingSoon} is the one sentence they share.
 */
export interface MemberProfileCopy {
  /** The tab labels, keyed as the screen keys them. */
  tabs: { details: string; actions: string; ai: string; items: string };
  /** The body of a tab whose feature has not shipped. */
  comingSoon: string;
  /** The read-only fields on the details tab. */
  fields: {
    baseRole: string;
    customRoles: string;
    memberSince: string;
    lastLogin: string;
  };
  /** A field with nothing to show (no custom roles, no recorded sign-in). */
  emptyValue: string;
  /** A userId that is not a member of this tenant. */
  notFoundTitle: string;
  notFoundBody: string;
  /** The read failed for any other reason. */
  loadFailed: string;
  retryAction: string;
  loading: string;
}

export interface TeamRoleDialogCopy {
  title: (member: string) => string;
  /** The title while no member is loaded (the dialog's closed frame). */
  fallbackTitle: string;
  systemGroupTitle: string;
  customGroupTitle: string;
  /** The warning while the selection has zero or two system roles. */
  exactlyOneSystemRole: string;
  cancelAction: string;
  saveAction: string;
}

export interface TeamRowMenuCopy {
  editRoles: string;
  activate: string;
  deactivate: string;
  remove: string;
  /** Burning a pending accountless invite. */
  cancelInvite: string;
  /** The menu's fallback row for an actor who may change nothing. */
  noActions: string;
}

export interface RbacWebCopy {
  /** The wrapped transport's last-resort failure sentence. */
  operationFailed: string;
  /** While the caller's own permission set is being fetched. */
  loading: string;
  /** When that fetch fails — the surface renders nothing else. */
  permissionsLoadFailed: string;
  tabs: { roles: string; team: string };
  /**
   * The words `@12-apps/ui`'s grid, toolbar and saved-view dialogs render.
   *
   * Typed as the UI package's own port and passed through — the grid ships no
   * sentences and THROWS rather than falling back, so a host mounting these
   * screens has to answer for it either way. Answering it here keeps the whole
   * surface's copy in one object instead of two.
   */
  dataViews: DataViewsCopy;
  /** The kebab's accessible name, announced verbatim by a screen reader. */
  menuLabel: string;
  /** The heading over a failed row action, in the shared snackbar. */
  actionErrorTitle: string;
  /** The dismiss affordance on a closable banner. */
  closeLabel: string;
  /** The confirm popups' shared words (the primitive's own port). */
  confirmAction: ConfirmActionCopy;
  permissionLabels: PermissionLabelsCopy;
  rolesList: RolesListCopy;
  rolesTable: RolesTableCopy;
  roleForm: RoleFormCopy;
  teamScreen: TeamScreenCopy;
  teamTable: TeamTableCopy;
  teamRoleDialog: TeamRoleDialogCopy;
  teamRowMenu: TeamRowMenuCopy;
  memberProfile: MemberProfileCopy;
}
