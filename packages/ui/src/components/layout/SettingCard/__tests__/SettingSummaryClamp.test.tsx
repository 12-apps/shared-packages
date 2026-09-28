/**
 * A setting's summary shows two lines at most, and an [i] beside the title
 * holds the rest — only while the text is actually cut.
 *
 * jsdom lays nothing out, so the measurement is stubbed: `scrollHeight` above
 * `clientHeight` is what a browser reports for a clamped paragraph.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EN_US_SETTING_CARD_COPY, EN_US_SETTING_SWITCH_COPY } from '../../../../en-US';
import { SettingCard } from '../SettingCard';
import { SettingToggle } from '../SettingToggle';

const LONG = 'A long explanation that a narrow card cannot hold in two lines, so the rest waits behind the info button.';

function stubLayout(cut: boolean): void {
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(cut ? 80 : 40);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(40);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the summary clamp', () => {
  it('offers an [i] with the whole text when a switch summary is cut', async () => {
    stubLayout(true);
    render(
      <SettingToggle
        title="Pay on delivery"
        summary={LONG}
        copy={EN_US_SETTING_SWITCH_COPY}
        checked={false}
        onChange={vi.fn()}
        dataTestId="toggle"
      />,
    );

    const info = await screen.findByRole('button', { name: 'Show the full text' });
    // Hover opens it (a click pins it; jsdom cannot lay out a pinned popper).
    fireEvent.mouseOver(info);
    expect(await screen.findByTestId('toggle-info-content')).toHaveTextContent(LONG);
    // The paragraph keeps every word, so the switch's description is whole.
    expect(screen.getByTestId('toggle-summary')).toHaveTextContent(LONG);
  });

  it('draws no [i] when the summary fits', () => {
    stubLayout(false);
    render(
      <SettingToggle
        title="Pay on delivery"
        summary="Short."
        copy={EN_US_SETTING_SWITCH_COPY}
        checked={false}
        onChange={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Show the full text' })).toBeNull();
  });

  it('offers the [i] on a closed card, and drops it while the card is open', async () => {
    stubLayout(true);
    render(
      <SettingCard title="Table clocks" summary={LONG} copy={EN_US_SETTING_CARD_COPY} onSave={vi.fn()} dataTestId="card">
        <div>form</div>
      </SettingCard>,
    );

    expect(await screen.findByRole('button', { name: 'Show the full text' })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('card-edit'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Show the full text' })).toBeNull());
  });

  it('names the [i] after the title when the host copy has no words for it', async () => {
    stubLayout(true);
    render(
      <SettingToggle
        title="Pay on delivery"
        summary={LONG}
        copy={{ saving: 'Saving…', saveFailed: 'Failed.' }}
        checked={false}
        onChange={vi.fn()}
      />,
    );

    expect(await screen.findByRole('button', { name: 'Pay on delivery' })).toBeInTheDocument();
  });
});
