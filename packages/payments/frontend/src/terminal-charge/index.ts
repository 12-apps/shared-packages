/**
 * `@12-apps/payments-frontend/terminal-charge` — a split charged through the
 * paired payment terminal at a station: each card or Pix leg pushed on its
 * own, the wait, the terminal's answers, and every path that could lose or
 * double money (a late approval after the leg was paid in cash, a capture
 * above the total, a terminal that is down, a reload mid-charge). The
 * terminal is the only source of payment truth: nothing here settles a card
 * or Pix leg on a code typed at the station, and a manual leg is offered only
 * while the terminal cannot be used.
 *
 * Headless at its core (`startFlow` and the moves are pure; `startChargeRun`
 * drives them over the host's {@link TerminalPort}), with generic screens on
 * top that take every word as props. Its own entry rather than the root
 * barrel's: a host with no terminal should not pull it.
 */
export {
  chargedSplit,
  confirmLabelOf,
  currentIndex,
  hasCapture,
  isDone,
  isLive,
  isStopped,
  linkDown,
  manualAllowed,
  partOf,
  readiness,
  remainingAfter,
  startFlow,
  withLink,
  type ConfirmWords,
} from './charge-flow';
export {
  ELSEWHERE_REFERENCE_MAX,
  cancelAnswered,
  cancelRequested,
  cashReceived,
  chargedElsewhere,
  otherTender,
  pendingCancelled,
  pushed,
  pushing,
  resend,
  serverRefused,
} from './flow-moves';
export { onEvent } from './flow-events';
export type {
  ChargedLeg,
  ChargedSplit,
  ChargeFlow,
  Elsewhere,
  FlowLeg,
  FlowMove,
  FlowNotice,
  FlowPending,
  LegExit,
  LegStatus,
  Readiness,
} from './flow-types';
export { startChargeRun, type ChargeRun, type ChargeRunInput } from './charge-run';
export { holdCharge, noteTaken, releaseCharges, strayApproval, watchCharges } from './charge-claims';
export {
  createHeldCaptures,
  heldCentsOf,
  preselectRecovered,
  unclaimedCount,
  withHeld,
  type HeldCapture,
  type HeldCaptures,
  type HeldRelease,
} from './held-captures';
export {
  MIN_REASON_LENGTH,
  createConfirmedAct,
  problemOf,
  type ConfirmedAct,
  type ConfirmedActAnswer,
  type ConfirmedActInput,
  type ConfirmedActProblem,
  type ConfirmedActState,
} from './confirmed-act';
export {
  captureWireOf,
  linkOf,
  terminalMethodOf,
  type CaptureWire,
  type ChargeLink,
  type TerminalCancelAnswer,
  type TerminalCaptureTrace,
  type TerminalChargeAnswer,
  type TerminalChargeRequest,
  type TerminalEvent,
  type TerminalMethod,
  type TerminalPendingCharge,
  type TerminalPort,
  type TerminalProvider,
  type TerminalState,
  type TerminalView,
} from './port';
export { useChargeFlow, useTerminalLink } from './hooks';
export type { ActConfirmCopy, ElsewhereCopy, OverCaptureCopy, ReceivedTwiceCopy, RecoveredCopy, TerminalWaitCopy } from './copy';
export { ActConfirm, type ActConfirmProps } from './act-confirm';
export { ElsewhereForm, type ElsewhereFormProps } from './elsewhere-form';
export {
  OverCaptureChoice,
  ReceivedTwiceBand,
  type OverCaptureAct,
  type OverCaptureChoiceProps,
  type ReceivedTwiceAct,
  type ReceivedTwiceBandProps,
} from './money-choices';
export { RecoveredCaptures, type RecoveredCapturesProps } from './recovered-captures';
export { TerminalWait, type TerminalWaitProps } from './terminal-wait';
