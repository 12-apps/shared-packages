// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { startChargeRun } from '../charge-run';
import type { ActConfirmCopy, OverCaptureCopy, ReceivedTwiceCopy, RecoveredCopy, TerminalWaitCopy } from '../copy';
import type { HeldCapture } from '../held-captures';
import { OverCaptureChoice, ReceivedTwiceBand } from '../money-choices';
import { RecoveredCaptures } from '../recovered-captures';
import { TerminalWait } from '../terminal-wait';
import { fakeTerminal, settle } from './fake-port';

/**
 * The generic screens of `terminal-charge` (FUT-4996 States 3, 4 and 5, and the wait), with
 * test copy: what each offers, and what reaches the host when it is pressed.
 */

afterEach(cleanup);

const money = (cents: number): string => `$${(cents / 100).toFixed(2)}`;
const tenderName = (tender: string): string => tender.toLowerCase();

const CONFIRM: ActConfirmCopy = {
  reasonLabel: 'Reason',
  reasonHint: 'At least 3 characters',
  reasonShort: 'Say why',
  pinLabel: 'PIN',
  pinMissing: 'Type your PIN',
  confirm: 'Confirm',
  back: 'Back',
  refused: { fallback: 'Not done', DANGER_PIN_REQUIRED: 'Wrong PIN' },
};
const TWICE: ReceivedTwiceCopy = {
  title: (amount) => `Paid twice: ${amount}`,
  lede: 'Give one back',
  giveBack: (amount) => `Give ${amount} back in cash`,
  refundCard: 'Refund the card',
  done: 'Done',
};
const OVER: OverCaptureCopy = {
  title: (amount) => `${amount} over`,
  lede: 'Choose',
  change: (amount) => `Give ${amount} change`,
  credit: (amount, buyer) => `Keep ${amount} for ${buyer}`,
  refundAndCharge: (refund, charge) => `Refund ${refund}, charge ${charge}`,
};
const RECOVERED: RecoveredCopy = { title: 'Received, no sale', line: (method, amount, at) => `${method} ${amount} ${at}`, count: (count) => `${count} with no sale` };
const WAIT: TerminalWaitCopy = {
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
  doneLine: (label) => `${label} done`,
  resend: 'Send again',
  other: 'Another tender',
  otherLabel: 'Tenders',
  cancel: 'Cancel on the terminal',
  cashReceived: (amount) => `Received ${amount}`,
  cancelPending: (amount) => `Cancel ${amount}`,
  settling: 'Settling',
};

function confirmWith(prefix: string, reason: string, pin: string): void {
  fireEvent.change(screen.getByTestId(`${prefix}-reason`), { target: { value: reason } });
  fireEvent.change(screen.getByTestId(`${prefix}-pin`), { target: { value: pin } });
  fireEvent.click(screen.getByTestId(`${prefix}-confirm`));
}

describe('State 4: received twice', () => {
  it('R11 (T2): the act is sent at once with its reason and PIN, and a short reason sends nothing', async () => {
    const onAct = vi.fn(async () => ({ ok: true as const }));
    const onDone = vi.fn();
    render(<ReceivedTwiceBand money="$32.00" copy={TWICE} confirmCopy={CONFIRM} onAct={onAct} onDone={onDone} />);

    fireEvent.click(screen.getByTestId('terminal-received-twice-refund-card'));
    confirmWith('terminal-received-twice-confirm', 'no', '1234');
    expect(await screen.findByText('Say why')).toBeTruthy();
    expect(onAct).not.toHaveBeenCalled();

    confirmWith('terminal-received-twice-confirm', 'paid twice', '1234');
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('refund-card'));
    expect(onAct).toHaveBeenCalledTimes(1);
    expect(onAct).toHaveBeenCalledWith('refund-card', { reason: 'paid twice', pin: '1234' });
  });

  it('says the host refusal, and keeps the band', async () => {
    const onAct = vi.fn(async () => ({ ok: false as const, code: 'DANGER_PIN_REQUIRED' }));
    const onDone = vi.fn();
    render(<ReceivedTwiceBand money="$32.00" copy={TWICE} confirmCopy={CONFIRM} onAct={onAct} onDone={onDone} />);

    fireEvent.click(screen.getByTestId('terminal-received-twice-give-back'));
    confirmWith('terminal-received-twice-confirm', 'paid twice', '0000');

    expect(await screen.findByText('Wrong PIN')).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe('State 5: over the total', () => {
  it('R23: offers store credit only with a buyer; change is the primary act', () => {
    const props = { excess: '$2.00', refund: '$34.00', charge: '$32.00', copy: OVER, confirmCopy: CONFIRM, onAct: vi.fn(), onDone: vi.fn() };
    const { rerender } = render(<OverCaptureChoice {...props} buyer={null} />);
    expect(screen.queryByTestId('terminal-over-capture-credit')).toBeNull();
    expect(screen.getByTestId('terminal-over-capture-change').textContent).toBe('Give $2.00 change');

    rerender(<OverCaptureChoice {...props} buyer="Ana" />);
    expect(screen.getByTestId('terminal-over-capture-credit').textContent).toBe('Keep $2.00 for Ana');
    expect(screen.getByTestId('terminal-over-capture-refund-and-charge').textContent).toBe('Refund $34.00, charge $32.00');
  });
});

describe('the terminal is down', () => {
  it('R44: offers send again and another tender, and another tender settles the leg at the counter', async () => {
    const port = fakeTerminal();
    port.pushAnswers = [{ ok: false, code: 'NOT_CONNECTED' }];
    const onReady = vi.fn();
    const run = startChargeRun({ port, split: { legs: [{ tender: 'DEBIT' }], changeCents: 0 }, totalCents: 4600, link: { known: true, terminals: 1 }, saleRef: 's', operator: 'o', onReady, onNotice: vi.fn() });
    await settle();
    render(<TerminalWait flow={run.current()} run={run} provider="Acquirer" tenders={[{ id: 'CASH', name: 'cash' }]} tenderName={tenderName} money={money} copy={WAIT} />);
    expect(screen.getByTestId('terminal-wait-title').textContent).toBe('The terminal is down');
    expect(screen.getByTestId('terminal-wait-resend')).toBeTruthy();
    expect(screen.queryByTestId('terminal-wait-other-machine')).toBeNull();

    fireEvent.click(screen.getByTestId('terminal-wait-other'));
    fireEvent.click(screen.getByTestId('terminal-wait-other-CASH'));

    expect(onReady).toHaveBeenCalledWith({ legs: [{ tender: 'CASH', amountCents: 4600 }], changeCents: 0 });
  });
});

describe('State 3: recovered on load', () => {
  const held = (code: string, amountCents: number): HeldCapture => ({ transactionCode: code, kind: 'CREDIT', amountCents, capturedAt: '2026-11-14T17:31:00.000Z', deviceId: 'dev-1' });

  it('R19: ticks the capture that fits, with no tap, and leaves out typed codes', async () => {
    const onChange = vi.fn();
    render(
      <RecoveredCaptures
        captures={[held('A', 4600), held('B', 1850), held('TYPED', 900)]}
        dueCents={4600}
        typedCodes={new Set(['TYPED'])}
        selected={[]}
        onChange={onChange}
        copy={RECOVERED}
        money={money}
        time={() => '14:31'}
        methodName={tenderName}
      />,
    );
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(['A']));
    expect(screen.queryByTestId('terminal-recovered-TYPED')).toBeNull();
    expect(screen.getByText('credit $18.50 14:31')).toBeTruthy();
  });
});
