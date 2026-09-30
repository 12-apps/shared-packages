import { ThemeProvider, createTheme } from '@mui/material/styles/index.js';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React, { useState } from 'react';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PT_BR_AUTOCOMPLETE_COPY } from '../../../../pt-BR';
import { Autocomplete } from '../Autocomplete';

/**
 * A single-select pick ends the search (FUT-2763).
 *
 * `runSelectItem` closed the list (`setOpen(false)`), but two effects reopened
 * it right after:
 *
 * - `useLocalFilter`'s effect depends on `activeIndex` (which a pick moves to
 *   -1) and, for a search pick, on `inputValue` (which becomes the picked
 *   label). It reruns on the next commit and `maybeAutoOpen` reopens the list,
 *   because `userClosedDropdown` was set only by click-away.
 * - In `async` mode, `useLoadingOpen` opens the list whenever `isLoading` is
 *   true and the input is non-empty, without reading `userClosedDropdown` at
 *   all — a host whose `onSelect` re-queries and flips `isLoading` back to
 *   `true` reopens it that way instead.
 *
 * The fix marks the pick's close as deliberate; typing again still reopens,
 * and `multiple` mode (which already clears the input on a pick) is untouched.
 */

const theme = createTheme();

interface Row {
  id: string;
  label: string;
}

const ROWS: Row[] = [
  { id: '1', label: 'Apple' },
  { id: '2', label: 'Apricot' },
  { id: '3', label: 'Banana' },
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

function SyncHarness({ multiple }: { multiple?: boolean }): React.JSX.Element {
  const [value, setValue] = useState('');
  const [selectedItems, setSelectedItems] = useState<Row[]>([]);
  return (
    <ThemeProvider theme={theme}>
      <Autocomplete<Row>
        copy={PT_BR_AUTOCOMPLETE_COPY}
        value={value}
        onChange={setValue}
        suggestions={ROWS}
        getKey={(row) => row.id}
        getLabel={(row) => row.label}
        multiple={multiple}
        selectedItems={selectedItems}
        onSelectedItemsChange={setSelectedItems}
        inputAriaLabel="cliente"
        // Long enough that the debounced onChange round-trip never lands
        // during a test: `s.inputValue` (what these assertions read) is
        // already updated synchronously by the pick, so the debounced value
        // is not needed — and a short one risks a STALE `p.value` arriving
        // after the pick and reverting `inputValue` via `useValueSync`,
        // which is a real but separate hazard from FUT-2763's bug.
        debounceMs={100000}
      />
    </ThemeProvider>
  );
}

/** `isLoading` is a prop, not internal state, so the test drives it via `rerender`. */
function AsyncHarness({ isLoading }: { isLoading: boolean }): React.JSX.Element {
  const [value, setValue] = useState('ap');
  return (
    <ThemeProvider theme={theme}>
      <Autocomplete<Row>
        copy={PT_BR_AUTOCOMPLETE_COPY}
        value={value}
        onChange={setValue}
        suggestions={ROWS.filter((row) => row.label.toLowerCase().includes('ap'))}
        getKey={(row) => row.id}
        getLabel={(row) => row.label}
        async
        isLoading={isLoading}
        inputAriaLabel="cliente"
        // See the comment on `SyncHarness`'s `debounceMs`.
        debounceMs={100000}
      />
    </ThemeProvider>
  );
}

/**
 * The first `option` in a listbox — 'Apple' throughout this file, given
 * `filterSuggestions`' order — but its label is split across a `<mark>` run
 * by the highlighter, so its accessible name is not a plain 'Apple'; select
 * by position instead.
 */
function firstOption(listbox: HTMLElement): HTMLElement {
  const option = within(listbox).getAllByRole('option')[0];
  if (!option) throw new Error('expected at least one option in the listbox');
  return option;
}

describe('Autocomplete: a single-select pick ends the search (FUT-2763)', () => {
  it('closes on a click pick and stays closed once effects flush, in sync mode', async () => {
    render(<SyncHarness />);
    const input = screen.getByRole('combobox', { name: 'cliente' });
    // A real `.focus()` (not the synthetic `focusIn` dispatch) so the input
    // is genuinely `document.activeElement` — matching the real browser,
    // where the option's `onMouseDown` keeps focus on the input throughout
    // a pick, so `runSelectItem`'s refocus is a true no-op, not a second
    // focus event.
    await act(async () => {
      // eslint-disable-next-line test-flakiness/no-focus-check, test-flakiness/await-async-events -- real synchronous focus so the pick's own refocus (below) is a true no-op, matching the browser
      input.focus();
    });
    fireEvent.change(input, { target: { value: 'ap' } });

    const listbox = await screen.findByRole('listbox');
    const option = firstOption(listbox);
    fireEvent.mouseDown(option);
    fireEvent.click(option);

    // `fireEvent` flushes React's synchronous + passive effects (including any
    // cascading re-render an effect schedules) before returning, so a fixed
    // `open` state is observable immediately — no polling needed, and no
    // window in which a reopening effect could still land unobserved.
    expect(input).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
  });

  it('closes on an Enter pick and stays closed once effects flush, in sync mode', async () => {
    render(<SyncHarness />);
    const input = screen.getByRole('combobox', { name: 'cliente' });
    // A real `.focus()` (not the synthetic `focusIn` dispatch) so the input
    // is genuinely `document.activeElement` — matching the real browser,
    // where the option's `onMouseDown` keeps focus on the input throughout
    // a pick, so `runSelectItem`'s refocus is a true no-op, not a second
    // focus event.
    await act(async () => {
      // eslint-disable-next-line test-flakiness/no-focus-check, test-flakiness/await-async-events -- real synchronous focus so the pick's own refocus (below) is a true no-op, matching the browser
      input.focus();
    });
    fireEvent.change(input, { target: { value: 'ap' } });
    await screen.findByRole('listbox');

    fireEvent.keyDown(input, { key: 'Enter' });

    expect(input).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
  });

  it('reopens once the user types another character, in sync mode', async () => {
    render(<SyncHarness />);
    const input = screen.getByRole('combobox', { name: 'cliente' });
    // A real `.focus()` (not the synthetic `focusIn` dispatch) so the input
    // is genuinely `document.activeElement` — matching the real browser,
    // where the option's `onMouseDown` keeps focus on the input throughout
    // a pick, so `runSelectItem`'s refocus is a true no-op, not a second
    // focus event.
    await act(async () => {
      // eslint-disable-next-line test-flakiness/no-focus-check, test-flakiness/await-async-events -- real synchronous focus so the pick's own refocus (below) is a true no-op, matching the browser
      input.focus();
    });
    fireEvent.change(input, { target: { value: 'ap' } });
    const listbox = await screen.findByRole('listbox');
    fireEvent.click(firstOption(listbox));
    expect(input).toHaveAttribute('aria-expanded', 'false');

    fireEvent.change(input, { target: { value: 'App' } });

    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('leaves multiple-select behaviour unchanged', async () => {
    render(<SyncHarness multiple />);
    const input = screen.getByRole('combobox', { name: 'cliente' });
    // A real `.focus()` (not the synthetic `focusIn` dispatch) so the input
    // is genuinely `document.activeElement` — matching the real browser,
    // where the option's `onMouseDown` keeps focus on the input throughout
    // a pick, so `runSelectItem`'s refocus is a true no-op, not a second
    // focus event.
    await act(async () => {
      // eslint-disable-next-line test-flakiness/no-focus-check, test-flakiness/await-async-events -- real synchronous focus so the pick's own refocus (below) is a true no-op, matching the browser
      input.focus();
    });
    fireEvent.change(input, { target: { value: 'ap' } });
    const listbox = await screen.findByRole('listbox');
    fireEvent.click(firstOption(listbox));

    // commitMultiSelect clears the input; the empty-input branch never reaches
    // maybeAutoOpen, so the list closes for that reason, same as on `main`.
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).toHaveValue('');

    fireEvent.change(input, { target: { value: 'ba' } });
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });
});

describe('Autocomplete: async isLoading does not reopen after a pick (FUT-2763)', () => {
  it('does not reopen when isLoading flips true again after a pick', async () => {
    const { rerender } = render(<AsyncHarness isLoading={false} />);
    const input = screen.getByRole('combobox', { name: 'cliente' });
    // A real `.focus()` (not the synthetic `focusIn` dispatch) so the input
    // is genuinely `document.activeElement` — matching the real browser,
    // where the option's `onMouseDown` keeps focus on the input throughout
    // a pick, so `runSelectItem`'s refocus is a true no-op, not a second
    // focus event.
    await act(async () => {
      // eslint-disable-next-line test-flakiness/no-focus-check, test-flakiness/await-async-events -- real synchronous focus so the pick's own refocus (below) is a true no-op, matching the browser
      input.focus();
    });
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // opens with the suggestions already given
    const listbox = await screen.findByRole('listbox');
    fireEvent.click(firstOption(listbox));
    expect(input).toHaveAttribute('aria-expanded', 'false');

    // The host's onSelect changed its query, and the refetch it triggers
    // flips `isLoading` back to `true` — simulated here as a prop update.
    // `rerender` flushes the resulting effects the same way `fireEvent` does.
    rerender(<AsyncHarness isLoading={true} />);

    expect(input).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
  });

  it('reopens once the user types another character after a pick', async () => {
    const { rerender } = render(<AsyncHarness isLoading={false} />);
    const input = screen.getByRole('combobox', { name: 'cliente' });
    // A real `.focus()` (not the synthetic `focusIn` dispatch) so the input
    // is genuinely `document.activeElement` — matching the real browser,
    // where the option's `onMouseDown` keeps focus on the input throughout
    // a pick, so `runSelectItem`'s refocus is a true no-op, not a second
    // focus event.
    await act(async () => {
      // eslint-disable-next-line test-flakiness/no-focus-check, test-flakiness/await-async-events -- real synchronous focus so the pick's own refocus (below) is a true no-op, matching the browser
      input.focus();
    });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const listbox = await screen.findByRole('listbox');
    fireEvent.click(firstOption(listbox));
    expect(input).toHaveAttribute('aria-expanded', 'false');

    fireEvent.change(input, { target: { value: 'Apple2' } });
    rerender(<AsyncHarness isLoading={true} />);

    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });
});
