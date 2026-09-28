/**
 * The search box is fetched on demand, and a fetch can fail: after a deploy the
 * previous build's chunk is gone. The select must stay usable either way.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Select } from '../Select';

vi.mock('../Select/Select.searchable', () => {
  throw new Error('chunk gone');
});

const NINE = Array.from({ length: 9 }, (_, index) => ({ value: `d${index}`, label: `Dia ${index}` }));

describe('Select — when the search box cannot load', () => {
  it('stays a working menu select with the same test ids and change shape', async () => {
    const onChange = vi.fn();
    render(<Select options={NINE} label="Dia" name="day" value="" onChange={onChange} data-testid="s" />);
    // Let the rejected import settle and the fallback commit.
    await act(async () => {
      await Promise.resolve();
    });
    const trigger = within(screen.getByTestId('s')).getByRole('combobox');
    expect(trigger.tagName).not.toBe('INPUT');
    fireEvent.mouseDown(trigger);
    const listbox = await screen.findByRole('listbox');
    fireEvent.click(within(listbox).getByTestId('s-option-d4'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0].target.value).toBe('d4');
  });
});
