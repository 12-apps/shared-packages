// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AwaitingPayment } from '../awaiting-payment';
import { ActivationCopyProvider } from '../copy-context';

import { TEST_COPY } from './fixtures';

/**
 * The panel an owner comes back to while a real charge sits outstanding at the
 * provider.
 *
 * Everything here is written around one failure: a screen that looks like it
 * has stopped watching gets the charge paid a second time. So the wait says how
 * long ago it asked, offers to ask right now, and never shows a pay button to
 * someone who has already paid.
 */

const LINK = 'https://provider.example.test/checkout/aaaa-bbbb-cccc';

function mount(props: Partial<Parameters<typeof AwaitingPayment>[0]> = {}) {
  return render(
    <ActivationCopyProvider copy={TEST_COPY}>
      <AwaitingPayment
        checkoutUrl={LINK}
        amountLabel="101 cents"
        lastCheckedAt={0}
        onCheckNow={vi.fn().mockResolvedValue(undefined)}
        {...props}
      />
    </ActivationCopyProvider>,
  );
}

afterEach(cleanup);

describe('a link that is still live', () => {
  it('leads with the state, not with what already happened', () => {
    mount();
    const panel = screen.getByTestId('verify-charge-awaiting');
    expect(panel.textContent).toContain('Waiting for the payment');
    expect(panel.textContent).toContain('We opened a tab to pay 101 cents.');
  });

  it('opens the payment page in a tab of its own', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    mount();
    fireEvent.click(screen.getByTestId('verify-charge-open-link'));
    expect(open).toHaveBeenCalledWith(LINK, '_blank', 'noopener');
    open.mockRestore();
  });

  /**
   * The address is folded away rather than removed. A hosted-checkout URL can
   * be hundreds of characters of opaque blob, so printing it in full made the
   * longest thing on screen the one thing nobody reads — but dropping it would
   * re-create the dead end for a blocked popup or a phone in the owner's hand.
   */
  it('keeps a real selectable anchor behind one click', async () => {
    mount();
    await waitFor(() => expect(screen.queryByTestId('verify-charge-checkout-url')).toBeNull());
    fireEvent.click(screen.getByTestId('verify-charge-toggle-link'));
    expect(screen.getByTestId('verify-charge-checkout-url').getAttribute('href')).toBe(LINK);
  });

  it('reveals that anchor when the clipboard refuses, which is the case that needs it', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    mount();
    fireEvent.click(screen.getByTestId('verify-charge-copy-link'));
    // A non-secure origin has no clipboard permission at all, so the fallback
    // is the whole feature there rather than an edge case.
    await waitFor(() => expect(screen.getByTestId('verify-charge-checkout-url')).not.toBeNull());
  });

  it('confirms a copy that worked', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    mount();
    fireEvent.click(screen.getByTestId('verify-charge-copy-link'));
    await waitFor(() =>
      expect(screen.getByTestId('verify-charge-copy-link').textContent).toBe('Copied'),
    );
  });

  it('reports a refused attempt without taking the link away', () => {
    mount({ declined: 'The card was declined.' });
    expect(screen.getByTestId('verify-charge-declined')).not.toBeNull();
    // Settling it would clear the outstanding charge and offer to mint a SECOND
    // real one while the first sits live at the provider.
    expect(screen.getByTestId('verify-charge-open-link')).not.toBeNull();
  });
});

describe('the return trip', () => {
  it('offers nothing to pay, because the owner already has', async () => {
    mount({ checkoutUrl: null });
    expect(screen.getByTestId('verify-charge-confirming')).not.toBeNull();
    await waitFor(() => expect(screen.queryByTestId('verify-charge-open-link')).toBeNull());
    await waitFor(() => expect(screen.queryByTestId('verify-charge-awaiting')).toBeNull());
  });

  it('still lets the owner ask right now', async () => {
    const onCheckNow = vi.fn().mockResolvedValue(undefined);
    mount({ checkoutUrl: null, onCheckNow });
    fireEvent.click(screen.getByTestId('verify-charge-check-now'));
    await waitFor(() => expect(onCheckNow).toHaveBeenCalledTimes(1));
  });
});

describe('before the provider has answered once', () => {
  it('says nothing at all, rather than claiming a check that never happened', async () => {
    mount({ lastCheckedAt: 0 });
    await waitFor(() => expect(screen.queryByTestId('verify-charge-last-checked')).toBeNull());
  });
});

describe('how long ago the provider was asked', () => {
  /** A fixed clock: the assertions are about elapsed seconds, not about now. */
  const CHECKED_AT = new Date('2026-01-01T00:00:00.000Z').getTime();
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(CHECKED_AT);
  });
  afterEach(() => vi.useRealTimers());

  /**
   * Read from the value the POLL owns, so it cannot drift away from the
   * requests actually being made — a counter of its own would go on reassuring
   * an owner about polling that had stopped.
   */
  it('ticks from the poll’s own timestamp', () => {
    mount({ lastCheckedAt: CHECKED_AT });
    expect(screen.getByTestId('verify-charge-last-checked').textContent).toBe('Last checked 0s ago');
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByTestId('verify-charge-last-checked').textContent).toBe('Last checked 3s ago');
  });
});
