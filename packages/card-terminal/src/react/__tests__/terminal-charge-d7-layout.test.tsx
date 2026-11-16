// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ActConfirm } from '../act-confirm';
import { ElsewhereForm } from '../elsewhere-form';
import { startChargeRun } from '../charge-run';
import { OverCaptureChoice, ReceivedTwiceBand } from '../money-choices';
import type { TerminalWaitCopy } from '../copy';
import type { ChargeLink } from '../port';
import { TerminalWait } from '../terminal-wait';
import { fakeTerminal, settle } from './fake-port';
import { CONFIRM, ELSEWHERE, OVER, TWICE, WAIT, money, tenderName } from './screen-copy';

/**
 * FUT-4996 (D7) review of the terminal-charge screens as a host rendered them:
 *
 * - States 4 and 5 put their buttons on the warning's fill, below AA, in the
 *   theme's UPPERCASE. The warning is now the theme's warning Alert and the
 *   buttons sit on the paper under it, ranked primary (solid), secondary (the
 *   primary inverted) and tertiary (text).
 * - The options of one question are ONE group of equal columns that stacks as
 *   a whole, never a flex row that wraps.
 * - 6-B: with the link down, a leg not sent yet said "sending". It says the
 *   terminal cannot be reached, with the manual exits.
 */

afterEach(cleanup);

const variantOf = (testId: string): string | undefined =>
  ['contained', 'outlined', 'text'].find((variant) => screen.getByTestId(testId).className.includes(`MuiButton-${variant}`));

describe('States 4 and 5: the question in a warning, the answers on the paper', () => {
  it('received twice: an amber warning Alert, never an error, and its two answers primary then secondary in one group', () => {
    render(<ReceivedTwiceBand money="$32.00" copy={TWICE} confirmCopy={CONFIRM} onAct={vi.fn()} onDone={vi.fn()} />);

    const warning = screen.getByRole('alert');
    expect(warning.className).toContain('MuiAlert-standardWarning');
    expect(warning.className).not.toContain('Error');
    expect(warning.textContent).toBe('Paid twice: $32.00Give one back');
    const group = screen.getByRole('group', { name: 'Paid twice: $32.00' });
    expect(group.getAttribute('data-choices')).toBe('2');
    expect(group.contains(screen.getByTestId('terminal-received-twice-give-back'))).toBe(true);
    expect([variantOf('terminal-received-twice-give-back'), variantOf('terminal-received-twice-refund-card')]).toEqual(['contained', 'outlined']);
    // The buttons are not inside the warning's fill.
    expect(warning.contains(group)).toBe(false);
  });

  it('over-capture: the three answers of one question are one group of three, ranked primary, secondary, tertiary', () => {
    render(<OverCaptureChoice excess="$2.00" refund="$34.00" charge="$32.00" buyer="Ana" copy={OVER} confirmCopy={CONFIRM} onAct={vi.fn()} onDone={vi.fn()} />);

    const group = screen.getByRole('group', { name: '$2.00 over' });
    expect(group.getAttribute('data-choices')).toBe('3');
    expect(
      ['change', 'credit', 'refund-and-charge'].map((act) => {
        const testId = `terminal-over-capture-${act}`;
        expect(group.contains(screen.getByTestId(testId))).toBe(true);
        return variantOf(testId);
      }),
    ).toEqual(['contained', 'outlined', 'text']);
  });

  it('over-capture with no buyer offers two answers, still one group', () => {
    render(<OverCaptureChoice excess="$2.00" refund="$34.00" charge="$32.00" buyer={null} copy={OVER} confirmCopy={CONFIRM} onAct={vi.fn()} onDone={vi.fn()} />);

    expect(screen.getByRole('group', { name: '$2.00 over' }).getAttribute('data-choices')).toBe('2');
  });

  it('the confirm step: confirm is primary, back is the secondary, side by side as one row', () => {
    render(<ActConfirm title="Refund the card" copy={CONFIRM} onSend={vi.fn()} onDone={vi.fn()} onBack={vi.fn()} />);

    expect([variantOf('terminal-act-confirm'), variantOf('terminal-act-back')]).toEqual(['contained', 'outlined']);
    expect(screen.getByTestId('terminal-act-confirm').parentElement).toBe(screen.getByTestId('terminal-act-back').parentElement);
  });
});

describe('focus and keyboard in a band', () => {
  it('the confirm step opens on its reason field, Enter in the PIN confirms, and back returns focus to the chosen button', async () => {
    const onAct = vi.fn(async () => ({ ok: true as const }));
    render(<ReceivedTwiceBand money="$32.00" copy={TWICE} confirmCopy={CONFIRM} onAct={onAct} onDone={vi.fn()} />);

    fireEvent.click(screen.getByTestId('terminal-received-twice-refund-card'));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('terminal-received-twice-confirm-reason')));
    fireEvent.click(screen.getByTestId('terminal-received-twice-confirm-back'));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('terminal-received-twice-refund-card')));

    fireEvent.click(screen.getByTestId('terminal-received-twice-give-back'));
    fireEvent.change(screen.getByTestId('terminal-received-twice-confirm-reason'), { target: { value: 'paid twice' } });
    fireEvent.change(screen.getByTestId('terminal-received-twice-confirm-pin'), { target: { value: '1234' } });
    fireEvent.submit(screen.getByTestId('terminal-received-twice-confirm-pin').closest('form') as HTMLFormElement);

    await waitFor(() => expect(onAct).toHaveBeenCalledWith('give-back', { reason: 'paid twice', pin: '1234' }));
  });
});

describe('6-B: the wait follows the link the host passes in', () => {
  function waitWith(link: ChargeLink) {
    return startChargeRun({ port: fakeTerminal(), split: { legs: [{ tender: 'CREDIT' }], changeCents: 0 }, totalCents: 4600, link, saleRef: 's', operator: 'o', onReady: vi.fn(), onNotice: vi.fn() });
  }

  it('with the link down, a leg not sent yet says the terminal cannot be reached — never "sending" — and offers the manual exits', async () => {
    const run = waitWith({ known: true, terminals: 1, down: true });
    await settle();

    render(<TerminalWait flow={run.current()} run={run} provider="Acquirer" tenders={[]} tenderName={tenderName} money={money} copy={WAIT} elsewhereCopy={ELSEWHERE} />);

    expect(screen.getByTestId('terminal-wait-title').textContent).toBe('The terminal cannot be reached');
    expect(screen.getByText('Nothing was sent to it')).toBeTruthy();
    const instead = screen.getByRole('group', { name: 'Tenders' });
    expect(instead).toBe(screen.getByTestId('terminal-wait-manual-exits'));
    expect(instead.textContent).toBe('Another tenderAnother machineManual Pix');
    expect(instead.getAttribute('data-choices')).toBe('3');
    expect(['terminal-wait-other', 'terminal-wait-other-machine', 'terminal-wait-manual-pix'].map(variantOf)).toEqual(['outlined', 'text', 'text']);
  });

  it('a host that gives no words for the down link gets the not-connected title and NO subtitle — never "sending", never a resend it cannot offer', async () => {
    const run = waitWith({ known: true, terminals: 1, down: true });
    await settle();
    const older: TerminalWaitCopy = { ...WAIT, down: undefined, downSub: undefined };

    render(<TerminalWait flow={run.current()} run={run} provider="Acquirer" tenders={[]} tenderName={tenderName} money={money} copy={older} elsewhereCopy={ELSEWHERE} />);

    expect(screen.getByTestId('terminal-wait-title').textContent).toBe('The terminal is down');
    expect(screen.getByTestId('terminal-wait-title').parentElement?.textContent).toBe('The terminal is down');
    await waitFor(() => expect(screen.queryByTestId('terminal-wait-resend')).toBeNull());
  });

  it('the link going down under a queued leg turns its words, and coming back turns them again', async () => {
    const run = waitWith({ known: true, terminals: 1, down: true });
    await settle();
    const props = { run, provider: 'Acquirer', tenders: [], tenderName, money, copy: WAIT, elsewhereCopy: ELSEWHERE };
    const { rerender } = render(<TerminalWait flow={run.current()} {...props} />);
    expect(screen.getByTestId('terminal-wait-title').textContent).toBe('The terminal cannot be reached');

    run.linkChanged({ known: true, terminals: 1 });
    await settle();
    rerender(<TerminalWait flow={run.current()} {...props} />);

    expect(screen.getByTestId('terminal-wait-title').textContent).not.toBe('The terminal cannot be reached');
  });
});

describe('6-B form: the package ranks and the host case (UI review B5)', () => {
  const caseOf = (testId: string): string => getComputedStyle(screen.getByTestId(testId)).textTransform;

  function form(onBack = vi.fn()) {
    const onConfirm = vi.fn();
    render(<ElsewhereForm via="OTHER_MACHINE" money="$46.00" preselected="CREDIT" methodName={tenderName} copy={ELSEWHERE} onConfirm={onConfirm} onBack={onBack} />);
    return onConfirm;
  }

  it('register is the primary and back the secondary, one group of two, in the case the host wrote', () => {
    const onBack = vi.fn();
    form(onBack);

    const actions = screen.getByTestId('terminal-elsewhere-actions');
    expect(actions.getAttribute('data-choices')).toBe('2');
    expect(actions.contains(screen.getByTestId('terminal-elsewhere-confirm'))).toBe(true);
    expect(actions.contains(screen.getByTestId('terminal-elsewhere-back'))).toBe(true);
    expect([variantOf('terminal-elsewhere-confirm'), variantOf('terminal-elsewhere-back')]).toEqual(['contained', 'outlined']);
    expect(['terminal-elsewhere-confirm', 'terminal-elsewhere-back'].map(caseOf)).toEqual(['none', 'none']);
    expect(screen.getByTestId('terminal-elsewhere-confirm').textContent).toBe('Record $46.00');

    fireEvent.click(screen.getByTestId('terminal-elsewhere-back'));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('credit or debit is one question: one named group of two options, in the host case, the choice pressed', () => {
    const onConfirm = form();

    const question = screen.getByRole('group', { name: 'Method' });
    expect(question).toBe(screen.getByTestId('terminal-elsewhere-method'));
    expect(question.getAttribute('data-choices')).toBe('2');
    expect(['terminal-elsewhere-method-CREDIT', 'terminal-elsewhere-method-DEBIT'].map(caseOf)).toEqual(['none', 'none']);
    expect(screen.getByTestId('terminal-elsewhere-method-CREDIT').getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByTestId('terminal-elsewhere-method-DEBIT'));
    expect(screen.getByTestId('terminal-elsewhere-method-DEBIT').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('terminal-elsewhere-method-CREDIT').getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByTestId('terminal-elsewhere-confirm'));
    expect(onConfirm).toHaveBeenCalledWith({ via: 'OTHER_MACHINE' }, 'DEBIT');
  });

  it('a manual Pix asks no method', () => {
    render(<ElsewhereForm via="MANUAL_PIX" money="$46.00" preselected="CREDIT" methodName={tenderName} copy={ELSEWHERE} onConfirm={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getAllByRole('button').map((button) => button.getAttribute('data-testid'))).toEqual(['terminal-elsewhere-confirm', 'terminal-elsewhere-back']);
    expect(variantOf('terminal-elsewhere-confirm')).toBe('contained');
  });
});
