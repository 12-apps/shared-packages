/**
 * `@12-apps/card-terminal/server` — the terminal capture ledger.
 *
 * A paired payment terminal takes a card or Pix capture; this subpath keeps
 * one record per capture, before or apart from any sale, and moves it from
 * UNBOUND to BOUND to the sale's payment row exactly once, whichever transport
 * (the terminal's own report, or the station relaying it) brings it first.
 * Only the terminal's word records a capture.
 *
 * Server-safe and dependency-free: no `node:` import, no database client. The
 * host binds the store and the two read-only directories (`./ports`) over its
 * own tables. The acts, the excess and the typed claims are CALLER-DRIVEN: they
 * move only the capture and answer what the caller must write in its own
 * sale, legs, till and audit — this package never writes them. A point of sale
 * depends on this package, never the other way round.
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
  type SaleRef,
  type Savepoint,
  type TerminalCaptureStore,
  type TerminalCaptureStoreFor,
  type TerminalDirectory,
} from './ports';
export {
  createTerminalCaptureLedger,
  type BindReport,
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
export { SWEEP_QUEUE } from './cadence';
export {
  captureActRefusalOf,
  createCaptureActs,
  planRebind,
  type CaptureActRefusal,
  type CaptureActRefused,
  type CaptureActs,
  type CaptureActsConfig,
  type CaptureLeg,
  type RebindCaptureInput,
  type RebindOutcome,
  type RebindPlan,
  type RebindRecord,
  type RefundCaptureInput,
  type RefundOutcome,
  type RefundRecord,
  type SettledLeg,
} from './capture-acts';
export {
  EXCESS_CHOICES,
  admitExcess,
  capturedAbove,
  createCaptureExcess,
  planExcess,
  type CaptureExcess,
  type CaptureExcessConfig,
  type ExcessCapture,
  type ExcessChoice,
  type ExcessCredit,
  type ExcessInput,
  type ExcessPlan,
  type ExcessRecord,
  type ExcessRefusal,
  type ExcessResolution,
  type ExcessSale,
  type ExcessSettled,
} from './capture-excess';
export {
  createTypedCaptureClaims,
  heldAnswer,
  timeoutHold,
  typedRefusalOf,
  type TypedBookAnswer,
  type TypedBookRefusal,
  type TypedCaptureClaims,
  type TypedCaptureClaimsConfig,
  type TypedCaptureInput,
  type TypedClaim,
} from './typed-booking';
