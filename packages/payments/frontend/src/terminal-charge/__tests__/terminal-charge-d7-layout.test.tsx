// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ActConfirm } from '../act-confirm';
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

  it('a host that gives no words for the down link gets the not-connected refusal and its sub, never "sending"', async () => {
    const run = waitWith({ known: true, terminals: 1, down: true });
    await settle();
    const older: TerminalWaitCopy = { ...WAIT, down: undefined, downSub: undefined };

    render(<TerminalWait flow={run.current()} run={run} provider="Acquirer" tenders={[]} tenderName={tenderName} money={money} copy={older} elsewhereCopy={ELSEWHERE} />);

    expect(screen.getByTestId('terminal-wait-title').textContent).toBe('The terminal is down');
    expect(screen.getByText('Charge it another way')).toBeTruthy();
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
