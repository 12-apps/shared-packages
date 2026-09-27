import { ThemeProvider, createTheme } from '@mui/material/styles/index.js';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import React, { useState } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { PT_BR_AUTOCOMPLETE_COPY } from '../../../../pt-BR';
import { Autocomplete } from '../Autocomplete';

/**
 * FUT-2779 #1: a pending debounced `onChange` must not outlive a pick.
 *
 * `runSelectItem` never touched `s.debounceRef`, so whether a still-pending
 * keystroke timer survives a pick depended entirely on what the picked branch
 * happened to do afterwards:
 *
 * - `commitSingleSelect` and `commitMultiSelect` each call the SAME
 *   `debouncedOnChange` the keystroke used, which clears any pending timer
 *   before rescheduling its own — so a plain search pick already happened to
 *   be safe, and stays safe here (see the two "search pick" cases below,
 *   which pass unchanged before and after the fix — they are a regression
 *   net, not the failing case).
 * - A `link` pick calls `openLink` instead and never touches `onChange` at
 *   all (`commitPick`'s `linkUrl !== null` branch). Nothing cancels the
 *   keystroke's timer, so it fires on schedule, `debounceMs` after the pick,
 *   carrying the STALE pre-pick text — even though the pick opened a link and
 *   never meant to change the input's committed value at all.
 *
 * The fix cancels any pending timer as soon as ANY pick runs, unconditionally
 * — before dispatching to `commitPick` — so it no longer matters which
 * branch does or doesn't call `onChange` itself.
 */

const theme = createTheme();

interface Row {
  id: string;
  label: string;
  type?: 'search' | 'link';
  url?: string;
}

const SEARCH_ROWS: Row[] = [
  { id: '1', label: 'Apple' },
  { id: '2', label: 'Apricot' },
];

const LINK_ROWS: Row[] = [
  { id: '1', label: 'Apple', type: 'link', url: 'https://example.com/apple' },
  { id: '2', label: 'Apricot' },
];

// jsdom has no layout, so no `scrollIntoView`; the hook scrolls the active
// option into view once the list opens.
const hadScrollIntoView = 'scrollIntoView' in Element.prototype;
beforeAll(() => {
  if (!hadScrollIntoView) {
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: () => undefined });
  }
});
afterAll(() => {
  if (!hadScrollIntoView) Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
});

function Harness({
  rows,
  onChange,
  openLink,
}: {
  rows: Row[];
  onChange: (val: string) => void;
  openLink: (url: string, item: Row) => void;
}): React.JSX.Element {
  const [value, setValue] = useState('');
  return (
    <ThemeProvider theme={theme}>
      <Autocomplete<Row>
        copy={PT_BR_AUTOCOMPLETE_COPY}
        value={value}
        onChange={(val) => {
          onChange(val);
          setValue(val);
        }}
        suggestions={rows}
        getKey={(row) => row.id}
        getLabel={(row) => row.label}
        getSuggestionType={(row) => row.type}
        getUrl={(row) => row.url}
        openLink={openLink}
        inputAriaLabel="cliente"
        debounceMs={150}
      />
    </ThemeProvider>
  );
}

function firstOption(listbox: HTMLElement): HTMLElement {
  const option = within(listbox).getAllByRole('option')[0];
  if (!option) throw new Error('expected at least one option in the listbox');
  return option;
}

describe('Autocomplete: a pick cancels a pending debounced onChange (FUT-2779 #1)', () => {
  it('does not deliver the stale pre-pick text after a click on a link suggestion', async () => {
    vi.useFakeTimers();
    try {
      const onChange = vi.fn();
      const openLink = vi.fn();
      render(<Harness rows={LINK_ROWS} onChange={onChange} openLink={openLink} />);
      const input = screen.getByRole('combobox', { name: 'cliente' });

      act(() => {
        // eslint-disable-next-line test-flakiness/no-focus-check, test-flakiness/await-async-events -- real synchronous focus, matching the browser
        input.focus();
      });
      fireEvent.change(input, { target: { value: 'ap' } }); // arms a 150ms timer for the STALE 'ap'

      const listbox = screen.getByRole('listbox');
      const option = firstOption(listbox);
      act(() => {
        fireEvent.mouseDown(option);
        fireEvent.click(option); // opens the link; never calls onChange itself
      });
      expect(openLink).toHaveBeenCalledWith('https://example.com/apple', expect.objectContaining({ id: '1' }));

      act(() => {
        vi.advanceTimersByTime(200); // past debounceMs
      });

      // FAILS on unfixed `useAutocomplete.ts`: the keystroke's timer was never
      // cancelled by the link pick, so it fires here with the stale 'ap'.
      expect(onChange).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not deliver the stale pre-pick text after an Enter pick on a link suggestion', async () => {
    vi.useFakeTimers();
    try {
      const onChange = vi.fn();
      const openLink = vi.fn();
      render(<Harness rows={LINK_ROWS} onChange={onChange} openLink={openLink} />);
      const input = screen.getByRole('combobox', { name: 'cliente' });

      act(() => {
        // eslint-disable-next-line test-flakiness/no-focus-check, test-flakiness/await-async-events -- real synchronous focus, matching the browser
        input.focus();
      });
      fireEvent.change(input, { target: { value: 'ap' } });
      screen.getByRole('listbox');

      act(() => {
        fireEvent.keyDown(input, { key: 'ArrowDown' }); // activeIndex -> 0
        fireEvent.keyDown(input, { key: 'Enter' }); // picks it, opens the link
      });
      expect(openLink).toHaveBeenCalledWith('https://example.com/apple', expect.objectContaining({ id: '1' }));

      act(() => {
        vi.advanceTimersByTime(200);
      });

      // FAILS on unfixed `useAutocomplete.ts`, same as the click case above.
      expect(onChange).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('still delivers only the picked label after a click on a search suggestion (regression net)', async () => {
    vi.useFakeTimers();
    try {
      const onChange = vi.fn();
      const openLink = vi.fn();
      render(<Harness rows={SEARCH_ROWS} onChange={onChange} openLink={openLink} />);
      const input = screen.getByRole('combobox', { name: 'cliente' });

      act(() => {
        // eslint-disable-next-line test-flakiness/no-focus-check, test-flakiness/await-async-events -- real synchronous focus, matching the browser
        input.focus();
      });
      fireEvent.change(input, { target: { value: 'ap' } }); // arms a 150ms timer for the STALE 'ap'

      const listbox = screen.getByRole('listbox');
      const option = firstOption(listbox);
      act(() => {
        fireEvent.mouseDown(option);
        fireEvent.click(option); // commits 'Apple' through the same debounced onChange
      });

      act(() => {
        vi.advanceTimersByTime(200);
      });

      // Was already safe (commitSingleSelect's own onChange call clears the
      // stale timer before rescheduling), and stays safe with the fix.
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith('Apple');
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves multiple-select behaviour unchanged (commitMultiSelect never went through this gap)', async () => {
    vi.useFakeTimers();
    try {
      const onChange = vi.fn();
      const openLink = vi.fn();
      function MultiHarness(): React.JSX.Element {
        const [value, setValue] = useState('');
        const [selectedItems, setSelectedItems] = useState<Row[]>([]);
        return (
          <ThemeProvider theme={theme}>
            <Autocomplete<Row>
              copy={PT_BR_AUTOCOMPLETE_COPY}
              value={value}
              onChange={(val) => {
                onChange(val);
                setValue(val);
              }}
              suggestions={SEARCH_ROWS}
              getKey={(row) => row.id}
              getLabel={(row) => row.label}
              openLink={openLink}
              multiple
              selectedItems={selectedItems}
              onSelectedItemsChange={setSelectedItems}
              inputAriaLabel="cliente"
              debounceMs={150}
            />
          </ThemeProvider>
        );
      }
      render(<MultiHarness />);
      const input = screen.getByRole('combobox', { name: 'cliente' });

      act(() => {
        // eslint-disable-next-line test-flakiness/no-focus-check, test-flakiness/await-async-events -- real synchronous focus, matching the browser
        input.focus();
      });
      fireEvent.change(input, { target: { value: 'ap' } });

      const listbox = screen.getByRole('listbox');
      const option = firstOption(listbox);
      act(() => {
        fireEvent.mouseDown(option);
        fireEvent.click(option); // commitMultiSelect: onChange('') clears the input
      });

      act(() => {
        vi.advanceTimersByTime(200);
      });

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith('');
      expect(input).toHaveValue('');
    } finally {
      vi.useRealTimers();
    }
  });
});
