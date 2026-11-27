import type { ActConfirmCopy, ElsewhereCopy, OverCaptureCopy, ReceivedTwiceCopy, RecoveredCopy, TerminalWaitCopy } from '../copy';

/** The test copy the `terminal-charge` screen suites share: English, and every key the host must give. */

export const money = (cents: number): string => `$${(cents / 100).toFixed(2)}`;
export const tenderName = (tender: string): string => tender.toLowerCase();

export const CONFIRM: ActConfirmCopy = {
  reasonLabel: 'Reason',
  reasonHint: 'At least 3 characters',
  reasonShort: 'Say why',
  pinLabel: 'PIN',
  pinMissing: 'Type your PIN',
  confirm: 'Confirm',
  back: 'Back',
  refused: { fallback: 'Not done', DANGER_PIN_REQUIRED: 'Wrong PIN' },
};
export const TWICE: ReceivedTwiceCopy = {
  title: (amount) => `Paid twice: ${amount}`,
  lede: 'Give one back',
  giveBack: (amount) => `Give ${amount} back in cash`,
  refundCard: 'Refund the card',
  done: 'Done',
};
export const OVER: OverCaptureCopy = {
  title: (amount) => `${amount} over`,
  lede: 'Choose',
  change: (amount) => `Give ${amount} change`,
  credit: (amount, buyer) => `Keep ${amount} for ${buyer}`,
  refundAndCharge: (refund, charge) => `Refund ${refund}, charge ${charge}`,
};
export const ELSEWHERE: ElsewhereCopy = {
  otherMachineTitle: 'Charged on another machine',
  manualPixTitle: 'Manual Pix',
  manualNote: 'Recorded as manual',
  methodLabel: 'Method',
  referenceLabel: 'Reference',
  referenceHint: 'Optional',
  fiscalNoteLine: 'The fiscal note is issued when the Pix is recorded',
  confirm: (amount) => `Record ${amount}`,
  back: 'Back',
};
export const RECOVERED: RecoveredCopy = {
  title: 'Received, no sale',
  lede: 'A charge was interrupted',
  line: (method, at) => `${method} · ${at}`,
  footnote: 'Unused after 24 h, it is refunded',
  count: (count) => `${count} with no sale`,
};
export const WAIT: TerminalWaitCopy = {
  where: (provider, method) => `${provider} · ${method}`,
  part: (part, parts) => `Part ${part} of ${parts}`,
  after: (amount) => `${amount} after`,
  sending: 'Sending',
  waiting: 'Waiting for the card',
  waitingSub: 'Insert',
  waitingPix: 'Waiting for the Pix',
  waitingPixSub: 'Scan',
  processing: 'Processing',
  processingSub: '…',
  cancelling: 'Cancelling',
  declined: 'Declined',
  declinedSub: 'Nothing charged',
  cancelled: 'Cancelled',
  cancelledSub: 'Nothing charged',
  unknown: 'Unknown',
  unknownSub: 'Check the terminal',
  away: 'Away',
  awaySub: 'Off the network',
  down: 'The terminal cannot be reached',
  downSub: 'Nothing was sent to it',
  unbound: 'Approved, no proof',
  unboundSub: 'Check',
  refused: { NOT_CONNECTED: 'The terminal is down' },
  refusedSub: 'Charge it another way',
  busySub: 'Another charge is open',
  conflict: 'The charge disagrees',
  conflictSub: 'It was charged',
  cash: (amount) => `Take ${amount} in cash`,
  cashSub: 'Moved to cash',
  waitingLink: 'Waiting for the terminal',
  waitingLinkSub: 'Or record it',
  doneLine: (label, nsu) => (nsu === undefined ? `${label} done` : `${label} done, NSU ${nsu}`),
  resend: 'Send again',
  other: 'Another tender',
  otherLabel: 'Tenders',
  cancel: 'Cancel on the terminal',
  otherMachine: 'Another machine',
  manualPix: 'Manual Pix',
  manualLine: (label) => `${label} · manual`,
  cashReceived: (amount) => `Received ${amount}`,
  cancelPending: (amount) => `Cancel ${amount}`,
  settling: 'Settling',
};
