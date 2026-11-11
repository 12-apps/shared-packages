/**
 * `variant="cards"` is a radio group (FUT-4477): a named `radiogroup` of
 * `radio`s with `aria-checked`, one Tab stop, arrows/Home/End that move and
 * choose, Space/Enter on the focused card, disabled cards skipped.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RadioGroup } from '../RadioGroup';

afterEach(cleanup);

const OPTIONS = [
  { value: 'a', label: 'Alpha', description: 'first' },
  { value: 'b', label: 'Beta', description: 'second' },
  { value: 'c', label: 'Gamma', disabled: true },
  { value: 'd', label: 'Delta' },
];

function Cards({ initial = 'a', onPick = vi.fn() }: { initial?: string; onPick?: (value: string) => void }): ReactElement {
  const [value, setValue] = useState(initial);
  return (
    <RadioGroup
      variant="cards"
      label="Kind"
      indicator
      options={OPTIONS}
      value={value}
      onChange={(_event, next) => {
        onPick(next);
        setValue(next);
      }}
      dataTestId="rg"
    />
  );
}

const radios = (): HTMLElement[] => screen.getAllByRole('radio');

describe('RadioGroup cards', () => {
  it('is a radiogroup named by its label, of radios with aria-checked', () => {
    render(<Cards />);
    const group = screen.getByRole('radiogroup', { name: 'Kind' });
    expect(group).toBeTruthy();
    expect(radios().map((radio) => radio.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false', 'false']);
    expect(radios()[2]!.getAttribute('aria-disabled')).toBe('true');
  });

  it('has one Tab stop, the checked card', () => {
    render(<Cards initial="b" />);
    expect(radios().map((radio) => radio.getAttribute('tabindex'))).toEqual(['-1', '0', '-1', '-1']);
  });

  it('moves and chooses with the arrows, skipping a disabled card, and wraps', async () => {
    const onPick = vi.fn();
    render(<Cards initial="b" onPick={onPick} />);
    fireEvent.keyDown(radios()[1]!, { key: 'ArrowRight' });
    expect(onPick).toHaveBeenLastCalledWith('d');
    await waitFor(() => expect(document.activeElement).toBe(radios()[3]));
    fireEvent.keyDown(radios()[3]!, { key: 'ArrowDown' });
    expect(onPick).toHaveBeenLastCalledWith('a');
    fireEvent.keyDown(radios()[0]!, { key: 'End' });
    expect(onPick).toHaveBeenLastCalledWith('d');
    fireEvent.keyDown(radios()[3]!, { key: 'Home' });
    expect(onPick).toHaveBeenLastCalledWith('a');
  });

  it('chooses the focused card with Space or Enter, and with a click; never a disabled one', () => {
    const onPick = vi.fn();
    render(<Cards onPick={onPick} />);
    fireEvent.keyDown(radios()[1]!, { key: ' ' });
    expect(onPick).toHaveBeenLastCalledWith('b');
    fireEvent.keyDown(radios()[3]!, { key: 'Enter' });
    expect(onPick).toHaveBeenLastCalledWith('d');
    fireEvent.click(radios()[2]!);
    expect(onPick).toHaveBeenCalledTimes(2);
  });

  it('takes its name from aria-label when there is no label', () => {
    render(<RadioGroup variant="cards" aria-label="Way" options={OPTIONS} value="a" />);
    expect(screen.getByRole('radiogroup', { name: 'Way' })).toBeTruthy();
  });

  it('draws a visible radio per card only with indicator, hidden from assistive tech', () => {
    render(<Cards />);
    expect(screen.getByTestId('rg-card-0').querySelector('input[type="radio"]')?.getAttribute('aria-hidden')).toBe('true');
    cleanup();
    render(<RadioGroup variant="cards" label="Kind" options={OPTIONS} value="a" dataTestId="rg" />);
    expect(screen.getByTestId('rg-card-0').textContent).toContain('Alpha');
    expect(screen.getByTestId('rg-card-0').querySelectorAll('input[type="radio"]')).toHaveLength(0);
  });
});
