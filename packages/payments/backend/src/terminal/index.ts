/**
 * `@12-apps/payments-backend/terminal` — the terminal capture ledger.
 *
 * A paired payment terminal takes a card or Pix capture; this subpath keeps
 * one record per capture, before or apart from any sale, and moves it from
 * UNBOUND to BOUND to the sale's payment row exactly once, whichever transport
 * (the terminal's own report, or the station relaying it) brings it first.
 * Only the terminal's word records a capture.
 *
 * Server-safe and dependency-free: no `node:` import, no database client. The
 * host binds the ports (`./ports`) over its own tables. Deliberately NOT on the
 * root barrel — a browser build never needs a capture ledger.
 */

export {
  CAPTURE_KINDS,
  CaptureError,
  PACKAGE_REFUND_REASONS,
  UNBOUND_ONLY_REASONS,
  clampToNow,
  notBoundReasonOf,
  refundLive,
  traceColumns,
  type BindTarget,
  type CaptureErrorCode,
  type CaptureKey,
  type CaptureKind,
  type CaptureNotBoundReason,
  type CaptureSource,
  type CaptureState,
  type StoredCaptureSource,
  type CaptureTrace,
  type PackageRefundReason,
  type RecordCaptureInput,
  type TerminalCaptureRecord,
} from './model';
export {
  captureFitsLeg,
  distinctCaptures,
  readDeviceCaptureReport,
  readStationCaptureWire,
  type CaptureReadLimits,
  type CaptureReadResult,
  type DeviceCaptureReport,
  type LegWithCapture,
  type StationCaptureWire,
} from './readers';
export {
  sqlSavepoint,
  type CapturePatch,
  type CaptureVersion,
  type NewTerminalCapture,
  type RawSqlHandle,
  type RefundFlag,
  type SaleDirectory,
  type Savepoint,
  type TerminalCaptureStore,
  type TerminalCaptureStoreFor,
  type TerminalDirectory,
} from './ports';
export {
  createTerminalCaptureLedger,
  type CaptureDevice,
  type DeviceCaptureAnswer,
  type TerminalCaptureLedger,
  type TerminalCaptureLedgerConfig,
} from './ledger';
export {
  createTerminalLegs,
  wireOf,
  type CaptureBinding,
  type HeldCaptures,
  type HeldForSale,
  type LegWire,
  type TerminalLegs,
  type TerminalLegsConfig,
} from './legs';
export {
  createNonRefusingCaptureBinder,
  type CaptureNotBound,
  type NonRefusingCaptureBinder,
  type NonRefusingCaptureBinderConfig,
  type NotBound,
  type SaleCapture,
} from './binder';
export {
  CAPTURE_SELECT,
  createPrismaTerminalCaptureStore,
  prismaTerminalCaptureStoreFor,
  type CaptureRow,
  type PrismaTerminalCaptureClient,
  type TerminalCaptureDelegate,
} from './prisma-store';
export { createMemoryTerminalCaptureStore, type MemoryTerminalCaptures } from './memory-store';
export {
  UNBOUND_CAPTURE_SWEEP_BATCH,
  UNBOUND_CAPTURE_SWEEP_CRON,
  terminalCaptureJobBlueprints,
  type TerminalCaptureJob,
  type TerminalCaptureJobContext,
  type TerminalCaptureJobDeps,
} from './job';
