/**
 * The configuration every `@12-apps/tenant` factory takes, and every later
 * slice extends.
 *
 * The package knows only "tenant". What a tenant IS (a shop, a hospital, a
 * clinic), what its statuses are called, which ids the host's clients and
 * audit trail already read, and every sentence a person sees are the host's,
 * and arrive here. Nothing below has a default: a missing piece fails at
 * startup (`validate.ts`), it never silently adopts another host's values.
 */

/**
 * The host's full status set for its tenant row.
 *
 * `all` is every value the host's row may hold, the closing three included.
 * The package acts ONLY on `active`, `closing` and `closed`, and never assumes
 * there are no others: a tenant in any status outside those three (a
 * suspended or pending one, say) is left alone, and a close records the status
 * it started from (`TenantClosing.priorStatus`) so a reopen can restore it.
 */
export interface TenantStatusSet<S extends string = string> {
  /** Every status the host's tenant row may hold. Non-empty, no duplicates. */
  all: readonly S[];
  /** The tenant is live: the state a close starts from by default. */
  active: S;
  /** A close is scheduled: read-only, the purge is pending, it can reopen. */
  closing: S;
  /** The purge ran. The row stays, for good. */
  closed: S;
}

/**
 * The refusal codes an API answers when a tenant's lifecycle refuses a
 * request. Clients read these, so the host keeps whatever values its clients
 * already understand.
 */
export interface TenantRefusalCodes {
  /** The tenant is closing: the act is refused while the close is pending. */
  closing: string;
  /** The tenant is closed: nothing is served any more. */
  closed: string;
  /** The tenant is read-only for this actor (a write during the close). */
  readOnly: string;
  /** The tenant's data is gone (the purge ran): the resource no longer exists. */
  gone: string;
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
  /** A data export is ready to download. */
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
 * Every sentence the package shows or sends, by key.
 *
 * WHOLE SENTENCES, never a noun to slot in: the tenant's noun changes the rest
 * of the sentence in gendered languages ("sua clínica será encerrada" / "seu
 * hospital será encerrado"), so only the host can write it. Placeholders, where
 * a later slice needs one, are named in braces (`{date}`) and documented on the
 * key that carries them.
 */
export const TENANT_COPY_KEYS = [
  // The close screen.
  'closeTitle',
  'closeWarning',
  'closeConfirm',
  'reopenTitle',
  'reopenConfirm',
  // What a person sees while the tenant is closing or closed.
  'closingBanner',
  'closedNotice',
  // The data export.
  'exportTitle',
  'exportRequest',
  'exportPreparing',
  'exportDownload',
  // E-mails.
  'exportReadyEmailSubject',
  'exportReadyEmailBody',
  'closingEmailSubject',
  'closingEmailBody',
  // Notifications.
  'notifyClosingScheduled',
  'notifyClosingWeek',
  'notifyClosingDay',
  'notifyExportReady',
  // Audit labels.
  'auditCloseScheduled',
  'auditCloseReopened',
  'auditClosePurged',
  'auditAfterCloseFailed',
  'auditExportRequested',
  'auditExportDownloaded',
  // Refusals, as a person reads them.
  'refusalClosing',
  'refusalClosed',
  'refusalReadOnly',
  'refusalGone',
] as const;

export type TenantCopyKey = (typeof TENANT_COPY_KEYS)[number];

/** One locale's full copy pack: every key, every value a non-empty sentence. */
export type TenantCopyPack = Readonly<Record<TenantCopyKey, string>>;

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
