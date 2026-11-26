/**
 * The configuration every `@12-apps/tenant` factory takes, and every later
 * slice extends.
 *
 * The package knows only "tenant". What a tenant IS (a shop, a hospital, a
 * clinic), what its statuses are called, which ids the host's clients and
 * audit trail already read, and every sentence a person sees are the host's,
 * and arrive here. Nothing below has a default: a missing piece fails at
 * startup (`validate.ts`), it never silently adopts another host's values.
 *
 * Every id and sentence the lifecycle, the purge and the export will need is
 * required NOW, in 1.0: a required piece added later would break every host's
 * config, so the set is complete from the first release.
 */

/**
 * The host's full status set for its tenant row.
 *
 * `all` is every value the host's row may hold, the closing three included.
 * The package acts ONLY on `active`, `closing`, `closed` and the statuses in
 * `closableFrom`, and never assumes there are no others: a tenant in any other
 * status (a pending one, say) is left alone. A close records the status it
 * started from (`TenantClosing.priorStatus`) so a reopen can restore it.
 */
export interface TenantStatusSet<S extends string = string> {
  /** Every status the host's tenant row may hold. Non-empty, no duplicates. */
  all: readonly S[];
  /** The tenant is live. */
  active: S;
  /** A close is scheduled: read-only, the purge is pending, it can reopen. */
  closing: S;
  /** The purge ran. The row stays, for good. */
  closed: S;
  /**
   * The statuses a close may start from: `active`, and any other the host
   * allows (a platform may close a suspended tenant). Non-empty, each listed
   * in `all`, never `closing` or `closed`.
   */
  closableFrom: readonly S[];
}

/**
 * The refusal codes an API answers when the lifecycle refuses a request.
 * Clients read these, so the host keeps whatever values its clients already
 * understand. Two refusals may not share a code.
 */
export interface TenantRefusalCodes {
  /** The tenant is closing: someone without the close permission is kept out. */
  closing: string;
  /** The tenant is closed: nothing is served any more. */
  closed: string;
  /** A write at a closing tenant by someone who may only read it. */
  readOnly: string;
  /** A public request (a checkout, say) reaching a tenant that closed. */
  gone: string;
  /** The close's reason is too short. */
  reasonTooShort: string;
  /** The name typed to confirm the close is not the tenant's. */
  nameMismatch: string;
  /** Closing a tenant that is already closing or closed. */
  alreadyClosing: string;
  /** Closing a tenant whose status is not in `closableFrom`. */
  notActive: string;
  /** Something still blocks the close (the host's blockers). */
  closingBlocked: string;
  /** Reopening after the purge: nothing is left to restore. */
  purged: string;
  /** Reopening a tenant that is not closing. */
  notClosing: string;
  /** A data export asked by an account with no person behind it: nobody to mail the link to. */
  exportNeedsPerson: string;
  /** The export's link names no export of this tenant, or one not built yet. */
  exportNotFound: string;
  /** The export's link is past its expiry. */
  exportExpired: string;
}

/** The audit action ids the package records. Each is the host's own id. */
export interface TenantAuditActionIds {
  /** A close was confirmed and scheduled. */
  closeScheduled: string;
  /** A pending close was undone. */
  closeReopened: string;
  /** The purge ran. */
  closePurged: string;
  /** The host's after-close hook failed; the sweep retries it. */
  afterCloseFailed: string;
  /** A data export was requested. */
  exportRequested: string;
  /** A data export was downloaded. */
  exportDownloaded: string;
}

/** The notification type ids the package raises. Each is the host's own id. */
export interface TenantNotificationTypeIds {
  /** A close was scheduled. */
  closingScheduled: string;
  /** The purge is a week away. */
  closingWeek: string;
  /** The purge is a day away. */
  closingDay: string;
  /** A pending close was undone. */
  reopened: string;
  /** A data export finished: ready to download, or failed (the payload says which). */
  exportReady: string;
}

/** The permission ids that gate the package's acts. Each is the host's own id. */
export interface TenantPermissionIds {
  /** Close and reopen the tenant, and take its data export. */
  close: string;
}

/** Every id the package uses. The package never makes one up. */
export interface TenantIds {
  refusals: TenantRefusalCodes;
  audit: TenantAuditActionIds;
  notifications: TenantNotificationTypeIds;
  permissions: TenantPermissionIds;
}

/**
 * Every sentence the package shows or sends, by key: what a copy pack holds.
 *
 * WHOLE SENTENCES, never a noun to slot in: the tenant's noun changes the rest
 * of the sentence in gendered languages ("sua clínica será encerrada" / "seu
 * hospital será encerrado"), so only the host can write it. A sentence that
 * carries a value is a FUNCTION the host writes, so it also owns plurals
 * (`count`) and word order. `name` is the tenant's name; a `day` is already
 * formatted for the pack's locale, in the tenant's time zone.
 *
 * `text` keys are non-empty strings; `sentence` keys are functions.
 */
export const TENANT_COPY_SHAPE = {
  // Notices, in the inbox and by e-mail (the title is the e-mail's subject).
  noticeScheduledTitle: 'sentence',
  noticeScheduledBody: 'sentence',
  noticeWeekTitle: 'sentence',
  noticeWeekBody: 'sentence',
  noticeDayTitle: 'sentence',
  noticeDayBody: 'sentence',
  noticeReopenedTitle: 'sentence',
  noticeReopenedBody: 'sentence',
  noticeExportReadyTitle: 'sentence',
  noticeExportReadyBody: 'sentence',
  noticeExportFailedTitle: 'sentence',
  noticeExportFailedBody: 'sentence',
  // Refusals, as a person reads them: one per refusal code.
  refusalClosing: 'text',
  refusalClosed: 'text',
  refusalReadOnly: 'text',
  refusalGone: 'text',
  refusalReasonTooShort: 'text',
  refusalNameMismatch: 'text',
  refusalAlreadyClosing: 'text',
  refusalNotActive: 'text',
  refusalBlocked: 'sentence',
  refusalPurged: 'text',
  refusalNotClosing: 'text',
  refusalExportNeedsPerson: 'text',
  refusalExportNotFound: 'text',
  refusalExportExpired: 'text',
  // The close page: its three steps (blockers, data, close) and the popup.
  pendingTitle: 'text',
  pendingNone: 'text',
  blocker: 'sentence',
  shortcut: 'sentence',
  dataTitle: 'text',
  dataTitlePlain: 'text',
  dataNote: 'text',
  dataAction: 'text',
  dataPreparing: 'text',
  dataOffline: 'text',
  closeTitle: 'text',
  closeExplain: 'text',
  closeAction: 'text',
  missing: 'sentence',
  dialogTitle: 'text',
  dialogBody: 'sentence',
  dialogUndo: 'text',
  nameLabel: 'text',
  nameHint: 'sentence',
  nameMismatch: 'text',
  reasonLabel: 'text',
  reasonPlaceholder: 'text',
  cancel: 'text',
  actFailed: 'text',
  loadFailed: 'text',
  retry: 'text',
  // The close page while closing, and once closed.
  closingTitle: 'text',
  closingBody: 'sentence',
  reopen: 'text',
  reopened: 'text',
  reopenNote: 'text',
  closedTitle: 'text',
  closedBody: 'text',
  // The banner every screen shows to whoever holds the close permission.
  bannerTitle: 'text',
  bannerBody: 'sentence',
  bannerReadOnly: 'text',
  // The refusal screen of a member a closing or closed tenant keeps out.
  refusedClosingTitle: 'text',
  refusedClosingBody: 'text',
  refusedClosedTitle: 'text',
  refusedClosedBody: 'text',
  switchTenant: 'text',
  signOut: 'text',
  seeClosing: 'text',
  // The platform's view of a closing tenant.
  platformCancelClosing: 'text',
  platformClosingNote: 'sentence',
} as const satisfies Record<string, 'text' | 'sentence'>;

export type TenantCopyKey = keyof typeof TENANT_COPY_SHAPE;

/** One locale's full copy pack: every key, typed. */
export interface TenantCopyPack {
  readonly noticeScheduledTitle: (name: string) => string;
  readonly noticeScheduledBody: (name: string, purgeDay: string) => string;
  readonly noticeWeekTitle: (name: string) => string;
  readonly noticeWeekBody: (name: string, purgeDay: string) => string;
  readonly noticeDayTitle: (name: string) => string;
  readonly noticeDayBody: (name: string) => string;
  readonly noticeReopenedTitle: (name: string) => string;
  readonly noticeReopenedBody: (name: string) => string;
  readonly noticeExportReadyTitle: (name: string) => string;
  readonly noticeExportReadyBody: (name: string, expiresDay: string) => string;
  readonly noticeExportFailedTitle: (name: string) => string;
  readonly noticeExportFailedBody: (name: string) => string;
  readonly refusalClosing: string;
  readonly refusalClosed: string;
  readonly refusalReadOnly: string;
  readonly refusalGone: string;
  readonly refusalReasonTooShort: string;
  readonly refusalNameMismatch: string;
  readonly refusalAlreadyClosing: string;
  readonly refusalNotActive: string;
  /** `count` items still block the close. */
  readonly refusalBlocked: (count: number) => string;
  readonly refusalPurged: string;
  readonly refusalNotClosing: string;
  readonly refusalExportNeedsPerson: string;
  readonly refusalExportNotFound: string;
  readonly refusalExportExpired: string;
  readonly pendingTitle: string;
  readonly pendingNone: string;
  /**
   * One line per kind of blocker; `kind` is one of the host's own blocker
   * kinds. `detail` is whatever the host's blocker read attached to it (an
   * amount and a date, say), passed through as given.
   */
  readonly blocker: (kind: string, count: number, detail?: Readonly<Record<string, string | number>>) => string;
  /** The shortcut that resolves a blocker of that kind. */
  readonly shortcut: (kind: string) => string;
  readonly dataTitle: string;
  readonly dataTitlePlain: string;
  readonly dataNote: string;
  readonly dataAction: string;
  readonly dataPreparing: string;
  readonly dataOffline: string;
  readonly closeTitle: string;
  readonly closeExplain: string;
  readonly closeAction: string;
  /** `count` blockers are left. */
  readonly missing: (count: number) => string;
  readonly dialogTitle: string;
  readonly dialogBody: (name: string) => string;
  readonly dialogUndo: string;
  readonly nameLabel: string;
  readonly nameHint: (name: string) => string;
  readonly nameMismatch: string;
  readonly reasonLabel: string;
  readonly reasonPlaceholder: string;
  readonly cancel: string;
  readonly actFailed: string;
  readonly loadFailed: string;
  readonly retry: string;
  readonly closingTitle: string;
  readonly closingBody: (sinceDay: string, purgeDay: string) => string;
  readonly reopen: string;
  readonly reopened: string;
  readonly reopenNote: string;
  readonly closedTitle: string;
  readonly closedBody: string;
  readonly bannerTitle: string;
  readonly bannerBody: (sinceDay: string, purgeDay: string) => string;
  readonly bannerReadOnly: string;
  readonly refusedClosingTitle: string;
  readonly refusedClosingBody: string;
  readonly refusedClosedTitle: string;
  readonly refusedClosedBody: string;
  readonly switchTenant: string;
  readonly signOut: string;
  readonly seeClosing: string;
  readonly platformCancelClosing: string;
  readonly platformClosingNote: (closedDay: string, purgeDay: string) => string;
}

/** The keys of a copy pack, in a fixed order. */
export const TENANT_COPY_KEYS = Object.keys(TENANT_COPY_SHAPE) as readonly TenantCopyKey[];

/**
 * The copy packs by locale tag (`pt-BR`, `en-US`). No pack ships with the
 * package. `defaultLocale` names the pack a request with no matching locale
 * reads, and must itself be one of the packs.
 */
export interface TenantCopyConfig {
  locales: Readonly<Record<string, TenantCopyPack>>;
  defaultLocale: string;
}

/** What both halves (`createApiTenant`, `createWebTenant`) are configured with. */
export interface TenantCoreConfig<S extends string = string> {
  statuses: TenantStatusSet<S>;
  ids: TenantIds;
  copy: TenantCopyConfig;
}
