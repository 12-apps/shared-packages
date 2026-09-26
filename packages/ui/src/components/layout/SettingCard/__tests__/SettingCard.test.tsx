/**
 * `SettingCard` — closed summary, in-place edit, async save, focus round trip
 * (FUT-2823).
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EN_US_SETTING_CARD_COPY as COPY } from '../../../../en-US';
import { SettingCard } from '../SettingCard';
import type { SettingCardProps } from '../SettingCard.types';
import { deferred } from './deferred';
import { emittedCss } from './emitted-css';

afterEach(cleanup);

function renderCard(props: Partial<SettingCardProps> = {}) {
  const onSave = props.onSave ?? vi.fn();
  render(
    <SettingCard
      title="Session timeout"
      summary="Sign out after 30 minutes"
      status={{ label: 'On', color: 'success' }}
      learnMore="Longer sessions are convenient on a shared device, and risky."
      copy={COPY}
      dataTestId="card"
      {...props}
      onSave={onSave}
    >
      <label htmlFor="minutes">Minutes</label>
      <input id="minutes" data-testid="minutes" />
    </SettingCard>,
  );
  return { onSave };
}

const openCard = () => fireEvent.click(screen.getByTestId('card-edit'));

describe('SettingCard closed', () => {
  it('shows title, status pill, summary and Edit — and no form', async () => {
    renderCard();

    expect(screen.getByRole('heading', { level: 3, name: 'Session timeout' })).toBeInTheDocument();
    expect(screen.getByTestId('card-status')).toHaveTextContent('On');
    expect(screen.getByTestId('card-summary')).toHaveTextContent('Sign out after 30 minutes');
    expect(screen.getByTestId('card-edit')).toHaveTextContent(COPY.edit);
    expect(screen.getByTestId('card')).toHaveAttribute('data-state', 'closed');
    await waitFor(() => expect(screen.queryByTestId('minutes')).toBeNull());
  });

  it("names Edit with the card's title, so a grid of cards is not a list of identical buttons", () => {
    renderCard();

    expect(screen.getByRole('button', { name: `${COPY.edit} Session timeout` })).toBeInTheDocument();
  });

  it('labels the section with its title', () => {
    renderCard();

    expect(screen.getByRole('region', { name: 'Session timeout' })).toBe(screen.getByTestId('card'));
  });

  it('disables Edit when the card is disabled', () => {
    renderCard({ disabled: true });

    expect(screen.getByTestId('card-edit')).toBeDisabled();
  });
});

describe('SettingCard open', () => {
  it('opens in place around the form, with no dialog', async () => {
    renderCard();
    expect(screen.getByTestId('card-summary')).toBeInTheDocument();
    openCard();

    expect(screen.getByTestId('minutes')).toBeInTheDocument();
    expect(screen.getByTestId('card-save')).toHaveTextContent(COPY.save);
    expect(screen.getByTestId('card-cancel')).toHaveTextContent(COPY.cancel);
    expect(screen.getByTestId('card')).toHaveAttribute('data-state', 'open');
    expect(screen.getByTestId('card')).toHaveAttribute('data-setting-card-open');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.queryByTestId('card-summary')).toBeNull();
    });
  });

  it('moves focus to the first field as it opens', async () => {
    renderCard();
    openCard();

    await waitFor(() => expect(screen.getByTestId('minutes')).toHaveFocus());
  });

  it('keeps the learn-more copy collapsed until its disclosure is pressed', () => {
    renderCard();
    openCard();
    const trigger = screen.getByTestId('card-learn-more');

    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('card-learn-more-content')).toHaveAttribute('aria-hidden', 'true');

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('card-learn-more-content')).toHaveAttribute('aria-hidden', 'false');
    expect(screen.getByText(/risky/)).toBeInTheDocument();
  });

  it('renders no disclosure when there is nothing to learn more about', async () => {
    renderCard({ learnMore: undefined });
    openCard();

    expect(screen.getByTestId('minutes')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('card-learn-more')).toBeNull());
  });

  it('spans the full grid row only while open', () => {
    renderCard();
    expect(emittedCss(screen.getByTestId('card'))).toContain('height:100%');
    expect(emittedCss(screen.getByTestId('card'))).not.toContain('grid-column:1/-1');

    openCard();

    expect(emittedCss(screen.getByTestId('card'))).toContain('grid-column:1/-1');
  });
});

describe('SettingCard save', () => {
  it('holds a saving state while the promise is pending, then closes and returns focus to Edit', async () => {
    const save = deferred();
    renderCard({ onSave: () => save.promise });
    openCard();
    fireEvent.click(screen.getByTestId('card-save'));

    await waitFor(() => expect(screen.getByTestId('card-save')).toHaveTextContent(COPY.saving));
    expect(screen.getByTestId('card-save')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('card-saving')).toBeInTheDocument();
    expect(screen.getByTestId('card')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('card-cancel')).toBeDisabled();

    save.resolve();

    await waitFor(() => expect(screen.getByTestId('card')).toHaveAttribute('data-state', 'closed'));
    await waitFor(() => expect(screen.getByTestId('card-edit')).toHaveFocus());
  });

  it('calls a pending save once, however often Save is pressed', async () => {
    const save = deferred();
    const onSave = vi.fn(() => save.promise);
    renderCard({ onSave });
    openCard();
    fireEvent.click(screen.getByTestId('card-save'));
    await waitFor(() => expect(screen.getByTestId('card-save')).toHaveTextContent(COPY.saving));

    fireEvent.click(screen.getByTestId('card-save'));
    fireEvent.click(screen.getByTestId('card-save'));

    expect(onSave).toHaveBeenCalledTimes(1);
    save.resolve();
    await waitFor(() => expect(screen.getByTestId('card')).toHaveAttribute('data-state', 'closed'));
  });

  it('stays open and shows the fallback sentence when the save rejects', async () => {
    renderCard({ onSave: () => Promise.reject(new Error('HTTP 500 from /api/settings')) });
    openCard();
    fireEvent.click(screen.getByTestId('card-save'));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(COPY.saveFailed));
    expect(screen.getByTestId('card')).toHaveAttribute('data-state', 'open');
    expect(screen.getByTestId('minutes')).toBeInTheDocument();
    expect(screen.getByTestId('card-save')).toHaveTextContent(COPY.save);
    expect(screen.getByTestId('card-save')).not.toHaveAttribute('aria-disabled');
    await waitFor(() => expect(screen.queryByText(/HTTP 500/)).toBeNull());
  });

  it("shows the host's sentence when formatError gives one", async () => {
    renderCard({
      onSave: () => Promise.reject(new Error('conflict')),
      formatError: (error) => (error instanceof Error && error.message === 'conflict' ? 'Someone else changed this.' : undefined),
    });
    openCard();
    fireEvent.click(screen.getByTestId('card-save'));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Someone else changed this.'));
    expect(screen.getByTestId('card-save')).toHaveAttribute('aria-describedby', screen.getByRole('alert').id);
  });

  it('treats a handler that throws synchronously as a failed save', async () => {
    renderCard({
      onSave: () => {
        throw new Error('boom');
      },
    });
    openCard();
    fireEvent.click(screen.getByTestId('card-save'));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(COPY.saveFailed));
    expect(screen.getByTestId('card')).toHaveAttribute('data-state', 'open');
  });

  it('closes on a synchronous success', async () => {
    const { onSave } = renderCard();
    openCard();
    fireEvent.click(screen.getByTestId('card-save'));

    await waitFor(() => expect(screen.getByTestId('card')).toHaveAttribute('data-state', 'closed'));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('refuses to save while saveDisabled', () => {
    const { onSave } = renderCard({ saveDisabled: true });
    openCard();

    expect(screen.getByTestId('card-save')).toBeDisabled();
    fireEvent.click(screen.getByTestId('card-save'));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('opens clean after a failed save was cancelled', async () => {
    renderCard({ onSave: () => Promise.reject(new Error('x')) });
    openCard();
    fireEvent.click(screen.getByTestId('card-save'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('card-cancel'));
    await waitFor(() => expect(screen.getByTestId('card')).toHaveAttribute('data-state', 'closed'));
    openCard();

    expect(screen.getByTestId('minutes')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});

describe('SettingCard cancel', () => {
  it('closes without saving, tells the host, and returns focus to Edit', async () => {
    const onCancel = vi.fn();
    const { onSave } = renderCard({ onCancel });
    openCard();
    fireEvent.click(screen.getByTestId('card-cancel'));

    await waitFor(() => expect(screen.getByTestId('card-edit')).toHaveFocus());
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId('minutes')).toBeNull());
  });

  it('discards an uncontrolled draft: the form reopens empty', () => {
    renderCard();
    openCard();
    fireEvent.change(screen.getByTestId('minutes'), { target: { value: '45' } });
    fireEvent.click(screen.getByTestId('card-cancel'));
    openCard();

    expect(screen.getByTestId('minutes')).toHaveValue('');
  });

  it('cancels on Escape from inside the form', async () => {
    const onCancel = vi.fn();
    renderCard({ onCancel });
    openCard();
    fireEvent.keyDown(screen.getByTestId('minutes'), { key: 'Escape' });

    await waitFor(() => expect(screen.getByTestId('card')).toHaveAttribute('data-state', 'closed'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('SettingCard controlled', () => {
  it('reports every open request and follows the open prop', async () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <SettingCard title="Language" copy={COPY} open={false} onOpenChange={onOpenChange} onSave={vi.fn()} dataTestId="c">
        <input data-testid="field" />
      </SettingCard>,
    );
    fireEvent.click(screen.getByTestId('c-edit'));

    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(screen.getByTestId('c')).toHaveAttribute('data-state', 'closed');
    await waitFor(() => expect(screen.queryByTestId('field')).toBeNull());

    rerender(
      <SettingCard title="Language" copy={COPY} open onOpenChange={onOpenChange} onSave={vi.fn()} dataTestId="c">
        <input data-testid="field" />
      </SettingCard>,
    );
    expect(within(screen.getByTestId('c')).getByTestId('field')).toBeInTheDocument();
  });

  it('does not steal focus when mounted open', async () => {
    render(
      <SettingCard title="Language" copy={COPY} defaultOpen onSave={vi.fn()} dataTestId="c">
        <input data-testid="field" />
      </SettingCard>,
    );

    expect(screen.getByTestId('field')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('field')).not.toHaveFocus());
  });
});
