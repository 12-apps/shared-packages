import type { ConfirmActionCopy } from '@12-apps/ui/copy';

/**
 * Every sentence the lifecycle admin surface renders — REQUIRED host config,
 * with NO defaults (the copy-portability doctrine): five screens compiled in
 * ~45 pt-BR strings a host could not reach, so every adopter shipped one
 * product's voice with nothing red. A pt-BR host imports
 * {@link PT_BR_LIFECYCLE_WEB_COPY} from `./pt-BR` (re-exported at the package
 * root) and passes it by hand — one reviewable line, never a silence.
 *
 * Facts travel as ARGUMENTS (a version number, a label, a formatted date), so
 * a translation can put them where its own grammar wants them.
 */

export interface ApprovalsCopy {
  /** The status filter's three options. */
  statusFilters: { pending: string; approved: string; rejected: string };
  /** The chip naming what a request wants to do. */
  actions: { create: string; update: string; delete: string };
  /** The empty state, per selected status. */
  emptyByStatus: { pending: string; approved: string; rejected: string };
  rejectDialogTitle: (label: string) => string;
  rejectDialogTitleNoTarget: string;
  rejectNoteLabel: string;
  approveAction: string;
  rejectAction: string;
  cancelAction: string;
  /** "Solicitado por Ana em" — the date renders right after it. */
  requestedBy: (name: string) => string;
  decisionFailedTitle: string;
  featureOffBody: string;
  loadFailedTitle: string;
  retryAction: string;
}

export interface RecycleBinCopy {
  restoreAction: string;
  purgeAction: string;
  purgeDialogTitle: string;
  purgeConfirmText: string;
  purgeBody: (label: string) => string;
  purgeTypeToConfirmLabel: (label: string) => string;
  purgeFailed: string;
  /**
   * The confirmation popup's own furniture — its cancel button and fallbacks.
   * `@12-apps/ui` stopped shipping defaults for these (FUT-760), so they are
   * this surface's config now rather than the design system's Portuguese.
   */
  confirmAction: ConfirmActionCopy;
  /** "Excluído em" — the date renders right after it. */
  deletedAtPrefix: string;
  /** " por Ana" — appended when the deleter is known. */
  deletedBy: (name: string) => string;
  emptyTitle: string;
  emptyBody: string;
  actionFailedTitle: string;
  loadFailedTitle: string;
  retryAction: string;
}

export interface VersionHistoryCopy {
  title: (itemLabel: string) => string;
  actions: { create: string; update: string; restore: string };
  currentBadge: string;
  restoreAction: string;
  compareAria: (version: number) => string;
  restored: (version: number) => string;
  sentToApproval: string;
  restoreDialogTitle: string;
  restoreDialogBody: (version: number) => string;
  restoreConfirm: string;
  cancelAction: string;
  emptyBody: string;
  featureOffBody: string;
  loadFailedTitle: string;
  retryAction: string;
}

export interface VersionComparisonCopy {
  /** The comparison table's first column: the field whose values differ. */
  fieldColumn: string;
  roles: { previous: string; selected: string; next: string; current: string };
  booleanTrue: string;
  booleanFalse: string;
  heading: (version: number) => string;
  singleVersionBody: string;
  noDifferences: string;
  loadFailedBody: string;
}

export interface DraftBannerCopy {
  title: string;
  /** "Atualizado em" — the date renders right after it. */
  updatedAtPrefix: string;
  /** The three actions, in the order they render. */
  load: string;
  publish: string;
  discard: string;
}

export interface LifecycleWebCopy {
  /** The wrapped transport's last-resort failure sentence. */
  operationFailed: string;
  /** Who acted when no user is recorded (a job, a migration). */
  systemActor: string;
  tabs: { recycleBin: string; approvals: string };
  approvals: ApprovalsCopy;
  recycleBin: RecycleBinCopy;
  versionHistory: VersionHistoryCopy;
  comparison: VersionComparisonCopy;
  draftBanner: DraftBannerCopy;
}
