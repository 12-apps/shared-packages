// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { startChargeRun } from '../charge-run';
import { TerminalWait } from '../terminal-wait';
import { fakeTerminal, settle, trace } from './fake-port';
import { ELSEWHERE, WAIT, money, tenderName } from './screen-copy';

/** FUT-5684: a done part of a split reads the acquirer's NSU when the terminal reported it. */

afterEach(cleanup);

async function splitWithFirstApproved(capture: ReturnType<typeof trace>): Promise<void> {
  const port = fakeTerminal();
  const run = startChargeRun({
    port,
    split: { legs: [{ tender: 'CREDIT' }, { tender: 'DEBIT' }], changeCents: 0 },
    totalCents: 9000,
    link: { known: true, terminals: 1 },
    saleRef: 's',
    operator: 'o',
    onReady: vi.fn(),
    onNotice: vi.fn(),
  });
  await settle();
  port.status('approved', { capture });
  await settle();
  render(<TerminalWait flow={run.current()} run={run} provider="Acquirer" tenders={[]} tenderName={tenderName} money={money} copy={WAIT} elsewhereCopy={ELSEWHERE} />);
}

describe('the done line of a split part', () => {
  it('names the NSU when the capture carries one', async () => {
    await splitWithFirstApproved({ ...trace(4500, 'CREDIT'), hostNsu: '004512' });
    expect(screen.getByText(`${tenderName('CREDIT')} done, NSU 004512`)).toBeTruthy();
  });

  it('keeps today\'s line when the terminal sent no NSU (an earlier release)', async () => {
    await splitWithFirstApproved(trace(4500, 'CREDIT'));
    expect(screen.getByText(`${tenderName('CREDIT')} done`)).toBeTruthy();
  });

  it('keeps today\'s line when the NSU is null', async () => {
    await splitWithFirstApproved({ ...trace(4500, 'CREDIT'), hostNsu: null });
    expect(screen.getByText(`${tenderName('CREDIT')} done`)).toBeTruthy();
  });
});
