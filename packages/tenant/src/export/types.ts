/**
 * The data export's config and its answers (opt-in, built with
 * `createTenantExport` on top of the lifecycle).
 *
 * The engine owns the mechanism: the request and its audit line, the build
 * job (claim, heartbeat, retry cap, READY or FAILED), the sweep (requeue,
 * fail, tell again, expire), the download (session and permission, 404, 410,
 * a presigned redirect), the notices, the streaming ZIP64 writer, CSV quoting
 * and formula neutralisation, and the purge-safe deletion. The host owns what
 * goes in the archive (its SECTIONS, each a named file of rows or bytes), the
 * archive port (where the private archive lives), its session check, its job
 * queue and its notification registry.
 */
import type { Readable } from 'node:stream';

/** An export's state. Stored as a String with a CHECK (`tenant_data_exports_status_check`). */
export type TenantDataExportStatus = 'PREPARING' | 'READY' | 'FAILED';

/** One `tenant_data_exports` row, as the package reads it. */
export interface TenantDataExportRow {
  id: string;
  tenantId: string;
  requestedById: string;
  status: TenantDataExportStatus;
  requestedAt: Date;
  startedAt: Date | null;
  readyAt: Date | null;
  expiresAt: Date | null;
  storageKey: string | null;
  sizeBytes: number | null;
  attempts: number;
  notifiedAt: Date | null;
  deletedAt: Date | null;
}

/** What a request writes into a fresh row. */
export type TenantDataExportCreate = Pick<TenantDataExportRow, 'id' | 'tenantId' | 'requestedById' | 'status' | 'requestedAt'>;

/**
 * A write's `data`, exactly as the engine hands it to `updateMany` (and to the
 * mirror): each field the value to SET, and `attempts` only ever incremented
 * by one (a claim).
 */
export interface TenantDataExportUpdate {
  status?: TenantDataExportStatus;
  startedAt?: Date;
  readyAt?: Date;
  expiresAt?: Date;
  storageKey?: string;
  sizeBytes?: number;
  notifiedAt?: Date;
  deletedAt?: Date;
  attempts?: { increment: 1 };
}

/** A build quiet since `stale`: never started and asked before it, or started before it. */
export type TenantDataExportQuiet = [
  { startedAt: null; requestedAt: { lt: Date } },
  { startedAt: { lt: Date } },
];

/** The filters the engine writes, Prisma-shaped (a host passes its delegate). */
export interface TenantDataExportWhere {
  id?: string;
  tenantId?: string;
  status?: TenantDataExportStatus;
  attempts?: { lt: number } | { gte: number };
  /** The heartbeat's and the holder's condition: the claim is still this one. */
  startedAt?: Date;
  notifiedAt?: null;
  deletedAt?: null;
  expiresAt?: { lte: Date };
  OR?:
    | TenantDataExportQuiet
    | [{ startedAt: null }, { startedAt: { lt: Date } }]
    | [{ status: 'READY'; readyAt: { lt: Date }; expiresAt: { gt: Date } }, { status: 'FAILED' }];
}

/**
 * The slice of the synced Prisma model (`tenantDataExport`) the package uses,
 * on the host's client or transaction: the delegate itself, or an adapter
 * with these six members.
 */
export interface TenantDataExportTable {
  create(args: { data: TenantDataExportCreate }): Promise<unknown>;
  findUnique(args: { where: { id: string } }): Promise<TenantDataExportRow | null>;
  findFirst(args: { where: TenantDataExportWhere }): Promise<TenantDataExportRow | null>;
  findMany(args: { where: TenantDataExportWhere; orderBy?: { requestedAt: 'asc' }; take: number }): Promise<TenantDataExportRow[]>;
  updateMany(args: { where: TenantDataExportWhere; data: TenantDataExportUpdate }): Promise<{ count: number }>;
  deleteMany(args: { where: { tenantId: string } }): Promise<{ count: number }>;
}

/**
 * OPT-IN expand-and-contract: a host moving an older export table onto
 * `tenant_data_exports` mirrors every package write into it, IN THE SAME
 * TRANSACTION as the package's own write, until its contract release drops it.
 */
export interface TenantDataExportMirror<Tx> {
  /** A request inserted `row`. */
  created(tx: Tx, row: TenantDataExportCreate): Promise<void>;
  /** A conditional write moved the row `id`: apply the same `data` to the older row of that id. */
  updated(tx: Tx, id: string, data: TenantDataExportUpdate): Promise<void>;
  /** The purge deleted every export row of the tenant. */
  deleted(tx: Tx, tenantId: string): Promise<void>;
}

/** What the download hands out: a presigned URL (a bucket), the file itself (local disk), or nothing (gone). */
export type TenantArchiveOpened =
  | { kind: 'redirect'; url: string }
  | { kind: 'stream'; body: ReadableStream<Uint8Array> }
  | { kind: 'missing' };

/**
 * Where the private archive lives: the host's (its bucket, its prefix, its
 * ACL). Every member is required.
 */
export interface TenantArchivePort {
  /** The object key of one export's archive (the host's key grammar). */
  key(tenantId: string, exportId: string): string;
  /** Store the built archive under `key`, streamed from `body` (`size` bytes): it is never in memory whole. */
  putStream(key: string, body: Readable, size: number): Promise<void>;
  /** Hand one archive out under `filename` (a short-lived presigned link), or say it is gone. */
  presign(key: string, filename: string): Promise<TenantArchiveOpened>;
  /** Delete one archive; gone already is not an error. */
  delete(key: string): Promise<void>;
  /**
   * Delete EVERY archive of the tenant, by its prefix rather than by its rows,
   * so one a failed build stored and never recorded goes too. Throws when
   * storage refuses: the purge stops before erasing anything, and resumes.
   */
  deleteTenant(tenantId: string): Promise<void>;
}

/** What every section is written with. */
export interface TenantExportContext {
  tenantId: string;
  /** The build's clock: the claim's instant. */
  now: Date;
  /** The tenant's IANA time zone, from the tenant port. */
  timeZone: string;
  /** The archive's language (`archiveLocale`): one of the copy's locale tags. */
  locale: string;
  /** Renew the build's claim; call it between pages of a long read. Throws once the claim is lost. */
  beat(): Promise<void>;
}

/**
 * A CSV cell. A plain string is a value a person may have typed: the engine
 * neutralises it for a spreadsheet (a leading `=`, `+`, `-`, `@`, tab or CR
 * gets a `'`). `{ raw }` is a value the host computed (an amount, a date, an
 * id) and is written as it is, only quoted.
 */
export type TenantExportCell = string | { raw: string };

/** One entry name, fixed or written in the archive's language. */
export type TenantExportName = string | ((at: TenantExportContext) => string);

/** A small file held whole (a catalogue the host already writes in its own format): bytes as given, never neutralised. */
export interface TenantExportFileSection {
  kind: 'file';
  name: TenantExportName;
  data(at: TenantExportContext): Promise<string | Uint8Array>;
}

/**
 * A CSV, streamed a page at a time: the header line (with the BOM a
 * spreadsheet needs to read UTF-8), then each page's lines, quoted (RFC
 * 4180, CRLF) and neutralised. The engine beats after every page.
 */
export interface TenantExportRowsSection {
  kind: 'rows';
  name: TenantExportName;
  header(at: TenantExportContext): readonly string[];
  pages(at: TenantExportContext): AsyncIterable<readonly (readonly TenantExportCell[])[]>;
}

/** One file of a `files` section. */
export interface TenantExportFile {
  name: string;
  data: string | Uint8Array;
}

/**
 * Many files copied as stored (documents, say), one at a time: each is
 * written and dropped before the next is read. The host beats between its
 * own pages (`at.beat`); the engine beats once the section is done.
 */
export interface TenantExportFilesSection {
  kind: 'files';
  files(at: TenantExportContext): AsyncIterable<TenantExportFile>;
}

/** One part of the archive, in archive order. */
export type TenantExportSection = TenantExportFileSection | TenantExportRowsSection | TenantExportFilesSection;

/** The export's own sentences, per locale: every tag of the base copy. */
export interface TenantExportCopyPack {
  /** The downloaded file's name for a build of `isoDay` (`2026-11-25`), extension included. */
  readonly archiveFilename: (isoDay: string) => string;
}

/** The keys of the export's copy pack, in a fixed order. */
export const TENANT_EXPORT_COPY_KEYS = ['archiveFilename'] as const satisfies readonly (keyof TenantExportCopyPack)[];

/** The export's audited acts. Its own type, so a host's exhaustive switch over the lifecycle's events keeps compiling. */
export type TenantExportAuditEvent =
  | { act: 'exportRequested'; tenantId: string; exportId: string }
  | { act: 'exportDownloaded'; tenantId: string; exportId: string };

/** What the ready (and failed) notice carries. */
export interface TenantExportNoticePayload {
  tenantId: string;
  name: string;
  slug: string;
  exportId: string;
  /** Whom to tell: the person who asked, never everyone with the permission. */
  requestedById: string;
  /** ISO instant the link stops working; null when the archive failed. */
  expiresAt: string | null;
  /** The archive could not be made. */
  failed: boolean;
}

/** Who is asking, as the host's session check answers it. */
export interface TenantExportActor {
  tenantId: string;
  /** The person behind the session; null for an account with none (an agent's key, say). */
  actorUserId: string | null;
}

/** Why a build was queued: the request's fast path, or the sweep's retry of a row at `attempts`. */
export type TenantExportEnqueue = { source: 'request' } | { source: 'sweep'; attempts: number };

/** The numbers the engine runs on. Every one is required: the package has no default. */
export interface TenantExportLimits {
  /** Days a READY link lives (never past the closing's purge date). Integer > 0. */
  linkDays: number;
  /** Builds per export, then FAILED and the person told. Integer > 0. */
  maxAttempts: number;
  /** A build whose claim was not renewed for this long died: the sweep queues it again. Integer ms > 0. */
  staleAfterMs: number;
  /** How often a running build renews its claim, at most. Integer ms > 0, below `staleAfterMs`. */
  beatEveryMs: number;
  /** Rows each sweep step reads per pass. Integer > 0. */
  sweepBatch: number;
}

export interface TenantExportConfig<Tx = unknown> {
  /** The host's transactions, and the package's table on a transaction or on the client. */
  db: {
    transaction<T>(run: (tx: Tx) => Promise<T>): Promise<T>;
    table(tx?: Tx): TenantDataExportTable | Promise<TenantDataExportTable>;
    /** Whether `error` is the one-PREPARING-per-tenant index refusing a second row (Prisma: `P2002`). */
    isUniqueViolation(error: unknown): boolean;
  };
  /** The archive, in archive order. At least one; entry names may not repeat. */
  sections: readonly TenantExportSection[];
  /** Where the private archive lives. */
  archives: TenantArchivePort;
  /** The numbers. */
  limits: TenantExportLimits;
  /** The export's sentences, per locale tag of the base copy. */
  copy: { locales: Readonly<Record<string, TenantExportCopyPack>> };
  /** The tenant's language for the archive and its filename (a tag of the base copy). */
  archiveLocale(tenantId: string): string | Promise<string>;
  /**
   * The session check of a request for `slug`: the signed-in person must hold
   * `permission` (`ids.permissions.close`) at that tenant. Throws to refuse
   * (the host's own 401 or 403); resolves with who is asking.
   */
  authorize(request: Request, at: { slug: string; permission: string }): Promise<TenantExportActor>;
  /** Queue one build of `exportId` on the host's job queue (the host names the job and its dedupe key). */
  enqueueBuild(exportId: string, why: TenantExportEnqueue): Promise<void>;
  /** Raise the notice of type `ids.notifications.exportReady`; true when RECORDED (only then is the row stamped). */
  notify(typeId: string, payload: TenantExportNoticePayload): Promise<boolean>;
  /** Write one audit line ON `tx`. `action` is `ids.audit[event.act]`. */
  audit(tx: Tx, action: string, event: TenantExportAuditEvent): Promise<void>;
  /** The expand-and-contract mirror, when the host is moving an older table. */
  mirror?: TenantDataExportMirror<Tx>;
}

/** What a request answers: the export now preparing, this one or the one already running. */
export interface TenantExportState {
  id: string;
  status: 'PREPARING';
  /** ISO. */
  requestedAt: string;
}

export type TenantExportBuildOutcome = 'built' | 'skipped' | 'failed';

export interface TenantExportSweepResult {
  /** Quiet builds with tries left, queued again. */
  queued: number;
  /** Quiet builds out of tries, failed. */
  failed: number;
  /** Notices sent again (READY after a while, or FAILED). */
  told: number;
  /** Archives past their link, deleted. */
  deleted: number;
}

export interface TenantExport {
  /** `POST`: ask for the tenant's archive (the session check, then one row and its audit line, then the build queued). */
  request(input: { request: Request; slug: string; now?: Date }): Promise<TenantExportState>;
  /** `GET`: the e-mailed link (the session check, 404, 410, then a presigned `302`, or the file). */
  download(input: { request: Request; slug: string; exportId: string; now?: Date }): Promise<Response>;
  /** The build job's handler: build one export if it is still to build. Never throws. */
  build(exportId: string, now?: Date): Promise<TenantExportBuildOutcome>;
  /** The sweep job's handler: one bounded pass. */
  sweep(now: Date): Promise<TenantExportSweepResult>;
  /** The purge's `beforeErase` hook: the tenant's rows first, then every archive under its prefix. */
  beforeErase(tenantId: string, at: { now: Date }): Promise<void>;
  /** When a link built at `now` stops working: `linkDays`, never after `purgeAt`. */
  expiryOf(now: Date, purgeAt: Date | null): Date;
  /** The downloaded file's name, in the tenant's archive language. */
  archiveFilename(tenantId: string, now: Date): Promise<string>;
  /** The notice's title and body, in `locale`, its day formatted in `timeZone`. */
  noticeWords(payload: TenantExportNoticePayload, at: { locale: string | null; timeZone: string }): { title: string; body: string };
}
