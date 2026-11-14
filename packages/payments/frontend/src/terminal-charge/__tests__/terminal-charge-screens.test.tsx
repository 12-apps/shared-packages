// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { startChargeRun } from '../charge-run';
import type { ActConfirmCopy, ElsewhereCopy, OverCaptureCopy, ReceivedTwiceCopy, RecoveredCopy, TerminalWaitCopy } from '../copy';
import { ElsewhereForm } from '../elsewhere-form';
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
const ELSEWHERE: ElsewhereCopy = {
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
  otherMachine: 'Another machine',
  manualPix: 'Manual Pix',
  manualLine: (label) => `${label} · manual`,
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

describe('State 6: the terminal is down', () => {
  const linkUp = { known: true as const, terminals: 1 };

  function runWith(answers: { ok: false; code: 'NOT_CONNECTED' }[]) {
    const port = fakeTerminal();
    port.pushAnswers = answers;
    const onReady = vi.fn();
    const run = startChargeRun({ port, split: { legs: [{ tender: 'DEBIT' }], changeCents: 0 }, totalCents: 4600, link: linkUp, saleRef: 's', operator: 'o', onReady, onNotice: vi.fn() });
    return { run, onReady };
  }

  it('R04: another machine keeps the method preselected, says the leg is manual, the reference optional, and asks no PIN', () => {
    const onConfirm = vi.fn();
    render(<ElsewhereForm via="OTHER_MACHINE" money="$46.00" preselected="DEBIT" methodName={tenderName} copy={ELSEWHERE} onConfirm={onConfirm} onBack={vi.fn()} />);
    expect(screen.getByTestId('terminal-elsewhere-method-DEBIT').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('terminal-elsewhere-manual-note').textContent).toBe('Recorded as manual');
    expect(screen.queryByTestId('terminal-act-pin')).toBeNull();

    fireEvent.click(screen.getByTestId('terminal-elsewhere-confirm'));

    expect(onConfirm).toHaveBeenCalledWith({ via: 'OTHER_MACHINE' }, 'DEBIT');
  });

  it('R05: a manual Pix says the fiscal note line in a store that issues one', () => {
    const onConfirm = vi.fn();
    render(<ElsewhereForm via="MANUAL_PIX" money="$46.00" preselected="CREDIT" methodName={tenderName} issuesFiscalNote copy={ELSEWHERE} onConfirm={onConfirm} onBack={vi.fn()} />);
    expect(screen.getByTestId('terminal-elsewhere-fiscal-note').textContent).toContain('fiscal note');
    fireEvent.click(screen.getByTestId('terminal-elsewhere-confirm'));
    expect(onConfirm).toHaveBeenCalledWith({ via: 'MANUAL_PIX' });
  });

  it('R44: refused as not connected, the wait offers send again and another tender, the two manual exits under them, and records a manual leg', async () => {
    const { run, onReady } = runWith([{ ok: false, code: 'NOT_CONNECTED' }]);
    await settle();
    render(<TerminalWait flow={run.current()} run={run} provider="Acquirer" tenders={[{ id: 'CASH', name: 'cash' }]} tenderName={tenderName} money={money} copy={WAIT} elsewhereCopy={ELSEWHERE} />);
    expect(screen.getByTestId('terminal-wait-title').textContent).toBe('The terminal is down');
    expect(screen.getByTestId('terminal-wait-resend')).toBeTruthy();
    expect(screen.getByTestId('terminal-wait-other')).toBeTruthy();
    expect(screen.getByTestId('terminal-wait-manual-exits').textContent).toBe('Another machineManual Pix');

    fireEvent.click(screen.getByTestId('terminal-wait-other-machine'));
    fireEvent.click(screen.getByTestId('terminal-wait-elsewhere-confirm'));

    expect(onReady).toHaveBeenCalledWith({ legs: [{ tender: 'DEBIT', amountCents: 4600, elsewhere: { via: 'OTHER_MACHINE' } }], changeCents: 0 });
  });

  it('R44 (owner rule): with the terminal usable the wait shows no manual exit', async () => {
    const { run } = runWith([]);
    await settle();
    render(<TerminalWait flow={run.current()} run={run} provider="Acquirer" tenders={[]} tenderName={tenderName} money={money} copy={WAIT} elsewhereCopy={ELSEWHERE} />);
    expect(screen.getByTestId('terminal-wait-cancel')).toBeTruthy();
    expect(screen.queryByTestId('terminal-wait-manual-exits')).toBeNull();
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
