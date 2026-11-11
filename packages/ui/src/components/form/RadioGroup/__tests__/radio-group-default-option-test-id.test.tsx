/**
 * An option's own `dataTestId` reaches the `default` variant's native radio (FUT-4724).
 *
 * The plain list look is what a host reaches for a short form question, in place
 * of a bare `<input type="radio">` in a hand-made label. Hosts and their tests
 * address that input by an id of their own, so the option's `dataTestId` lands on
 * the `<input>` (not on the Radio's wrapper span), where `checked` and `click` work.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RadioGroup } from '../RadioGroup';

const OPTIONS = [
  { value: 'a', label: 'Option A', dataTestId: 'pick-a' },
  { value: 'b', label: 'Option B', dataTestId: 'pick-b' },
  { value: 'c', label: 'Option C' },
];

describe('RadioGroup default variant, option test ids', () => {
  it('puts the option id on the native radio input', () => {
    render(<RadioGroup options={OPTIONS} value="b" dataTestId="rg" />);

    const a = screen.getByTestId('pick-a') as HTMLInputElement;
    expect(a.tagName).toBe('INPUT');
    expect(a.type).toBe('radio');
    expect((screen.getByTestId('pick-b') as HTMLInputElement).checked).toBe(true);
    expect(a.checked).toBe(false);
  });

  it('clicking that input chooses the option', () => {
    const onChange = vi.fn();
    render(<RadioGroup options={OPTIONS} value="b" onChange={onChange} dataTestId="rg" />);
    fireEvent.click(screen.getByTestId('pick-a'));
    expect(onChange).toHaveBeenCalledWith(expect.anything(), 'a');
  });

  it('leaves an option with no id on the index-based ids only', () => {
    render(<RadioGroup options={OPTIONS} dataTestId="rg" />);
    expect(screen.getByTestId('rg-radio-2')).toBeTruthy();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });
});
