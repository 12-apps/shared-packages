/**
 * `SettingToggle` — a switch that saves the moment it flips (FUT-2823).
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EN_US_SETTING_SWITCH_COPY as COPY } from '../../../../en-US';
import { SettingToggle } from '../SettingToggle';
import type { SettingToggleProps } from '../SettingCard.types';
import { deferred } from './deferred';

afterEach(cleanup);

/** The host: it owns `checked`, and only moves it once the save resolved. */
function Host({ save, ...props }: Partial<SettingToggleProps> & { save: (next: boolean) => Promise<void> | void }) {
  const [checked, setChecked] = useState(false);
  return (
    <SettingToggle
      title="Email alerts"
      summary="A message for every new sign-in"
      copy={COPY}
      dataTestId="toggle"
      {...props}
      checked={checked}
      onChange={async (next) => {
        await save(next);
        setChecked(next);
      }}
    />
  );
}

const input = () => screen.getByTestId('toggle-switch') as HTMLInputElement;

describe('SettingToggle', () => {
  it('names the switch with its title and describes it with its summary', () => {
    render(<Host save={vi.fn()} />);

    const control = screen.getByRole('switch', { name: 'Email alerts' });
    expect(control).toBe(input());
    const described = control.getAttribute('aria-describedby') ?? '';
    expect(described.split(' ').map((id) => document.getElementById(id)?.textContent)).toContain(
      'A message for every new sign-in',
    );
  });

  it('has no edit state: flipping it saves at once', async () => {
    const save = vi.fn();
    render(<Host save={save} />);
    fireEvent.click(input());

    await waitFor(() => expect(input()).toBeChecked());
    expect(save).toHaveBeenCalledWith(true);
    await waitFor(() => expect(screen.queryByRole('button', { name: /edit/i })).toBeNull());
  });

  it('shows the flip and a saving state while the save is pending, without disabling the switch', async () => {
    const pending = deferred();
    render(<Host save={() => pending.promise} />);
    fireEvent.click(input());

    await waitFor(() => expect(screen.getByTestId('toggle-saving')).toBeInTheDocument());
    expect(input()).toBeChecked();
    expect(input()).toHaveAttribute('aria-busy', 'true');
    expect(input()).not.toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(COPY.saving);

    pending.resolve();
    await waitFor(() => expect(input()).toHaveAttribute('aria-busy', 'false'));
    expect(input()).toBeChecked();
  });

  it('ignores a second flip while the first is saving', async () => {
    const pending = deferred();
    const save = vi.fn(() => pending.promise);
    render(<Host save={save} />);
    fireEvent.click(input());
    await waitFor(() => expect(screen.getByTestId('toggle-saving')).toBeInTheDocument());

    fireEvent.click(input());

    expect(save).toHaveBeenCalledTimes(1);
    expect(input()).toBeChecked();
    pending.resolve();
    await waitFor(() => expect(input()).toHaveAttribute('aria-busy', 'false'));
  });

  it('reverts and shows the error when the save rejects', async () => {
    render(<Host save={() => Promise.reject(new Error('offline'))} />);
    fireEvent.click(input());

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(COPY.saveFailed));
    expect(input()).not.toBeChecked();
    expect(input().getAttribute('aria-describedby')).toContain(screen.getByRole('alert').id);
  });

  it('uses the host sentence from formatError', async () => {
    render(<Host save={() => Promise.reject(new Error('quota'))} formatError={() => 'Plan limit reached.'} />);
    fireEvent.click(input());

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Plan limit reached.'));
  });

  it('draws a card by default and a flat row on request', () => {
    const { unmount } = render(<Host save={vi.fn()} />);
    expect(screen.getByTestId('toggle').tagName).toBe('SECTION');
    unmount();

    render(<Host save={vi.fn()} variant="row" />);
    expect(screen.getByTestId('toggle').tagName).toBe('DIV');
    expect(screen.getByTestId('toggle')).toHaveAttribute('data-variant', 'row');
  });

  it('disables the switch when disabled', () => {
    render(<Host save={vi.fn()} disabled />);

    expect(input()).toBeDisabled();
  });
});
