import { ThemeProvider, createTheme } from '@mui/material/styles/index.js';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React, { useLayoutEffect, useState } from 'react';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PT_BR_AUTOCOMPLETE_COPY } from '../../../../pt-BR';
import { Autocomplete } from '../Autocomplete';

/**
 * FUT-2780: FUT-2763's fix reopens again on a slow main thread.
 *
 * `runSelectItem` (useAutocomplete.ts:214-232) marks a pick's close as
 * deliberate with `setUserClosedDropdown(true)` — a STATE update, applied
 * only on the next render. `useLocalFilter`'s effect (useAutocomplete.ts:
 * 142-166, ending in `maybeAutoOpen` at :130-140) and `useLoadingOpen`
 * (useAutocomplete.ts:100-114) each close over the `userClosedDropdown`
 * value from the render that scheduled them. When a keystroke's render
 * schedules one of these effects and the pick lands before that effect
 * runs, the effect still reads the STALE `userClosedDropdown === false` it
 * captured before the pick — so `maybeAutoOpen`/`useLoadingOpen` reopen the
 * list — and since neither ever closes it back, the list stays open.
 *
 * Reproducing this with two plain `fireEvent` calls (even both inside one
 * manual `act(() => { ... })`) does not work in this React/jsdom setup:
 * every discrete DOM event this package's tests dispatch (`fireEvent` or a
 * raw `dispatchEvent`, act-wrapped or not) settles its own commit AND that
 * commit's passive effects fully, synchronously, before the call returns —
 * so by the time a second `fireEvent` runs, the first keystroke's effect
 * has already flushed and there is no window left to race into. That
 * matches the ticket's finding of 0/33 unthrottled runs reproducing in the
 * real browser too: normally the effect settles well before a human (or an
 * automated click) can land. Only a throttled main thread stretches that
 * gap enough to expose it (7/25 at 4x, per the linked ticket).
 *
 * To reproduce the same window deterministically, this harness uses one of
 * React's own ordering guarantees instead of chasing that timing: for a
 * single commit, EVERY `useLayoutEffect` runs — synchronously, right after
 * the DOM update — before ANY of that commit's `useEffect`s. `RaceInjector`
 * is mounted (via `renderSuggestion`) as a child inside Autocomplete's own
 * component tree, so its `useLayoutEffect` re-runs on every commit
 * Autocomplete itself makes, including a keystroke's. When a pick has been
 * queued (`pendingPickRef`), that layout effect fires it right there —
 * exactly the point where the keystroke's own `useLocalFilter` or
 * `useLoadingOpen` effect is scheduled but has not run yet.
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

/**
 * Mounted in place of the first suggestion's content. Its `useLayoutEffect`
 * runs on every commit Autocomplete makes; when the test has queued a pick
 * via `pendingPickRef`, it fires that pick from here — after the commit's
 * DOM update, but strictly before this same commit's passive effects.
 */
function RaceInjector({
  pendingPickRef,
}: {
  pendingPickRef: React.RefObject<(() => void) | null>;
}): React.JSX.Element {
  useLayoutEffect(() => {
    if (!pendingPickRef.current) return;
    const pick = pendingPickRef.current;
    pendingPickRef.current = null;
    pick();
  });
  return <>Apple</>;
}

function SyncHarness({
  pendingPickRef,
}: {
  pendingPickRef: React.RefObject<(() => void) | null>;
}): React.JSX.Element {
  const [value, setValue] = useState('ap');
  return (
    <ThemeProvider theme={theme}>
      <Autocomplete<Row>
        copy={PT_BR_AUTOCOMPLETE_COPY}
        value={value}
        onChange={setValue}
        suggestions={ROWS}
        getKey={(row) => row.id}
        getLabel={(row) => row.label}
        renderSuggestion={(row) =>
          row.id === '1' ? <RaceInjector pendingPickRef={pendingPickRef} /> : row.label
        }
        inputAriaLabel="cliente"
        // See the SyncHarness comment in autocomplete-closes-after-pick.test.tsx:
        // long enough that the debounced round-trip never lands mid-test.
        debounceMs={100000}
      />
    </ThemeProvider>
  );
}

/** `isLoading` is a prop, not internal state — stays `true` for the whole test. */
function AsyncHarness({
  pendingPickRef,
}: {
  pendingPickRef: React.RefObject<(() => void) | null>;
}): React.JSX.Element {
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
        renderSuggestion={(row) =>
          row.id === '1' ? <RaceInjector pendingPickRef={pendingPickRef} /> : row.label
        }
        async
        isLoading
        inputAriaLabel="cliente"
        debounceMs={100000}
      />
    </ThemeProvider>
  );
}

function firstOption(listbox: HTMLElement): HTMLElement {
  const option = listbox.querySelector('[role="option"]');
  if (!option) throw new Error('expected at least one option in the listbox');
  return option as HTMLElement;
}

function clickPick(option: HTMLElement): void {
  option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  option.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

describe('Autocomplete: a pending passive effect does not reopen the list after a pick (FUT-2780)', () => {
  it('stays closed when a click pick lands while the keystroke effect is still pending, in sync mode', async () => {
    const pendingPickRef = React.createRef<(() => void) | null>() as React.RefObject<(() => void) | null>;
    render(<SyncHarness pendingPickRef={pendingPickRef} />);
    const input = screen.getByRole('combobox', { name: 'cliente' });
    await act(async () => {
      // eslint-disable-next-line test-flakiness/no-focus-check, test-flakiness/await-async-events -- real synchronous focus so `option` below is a real, clickable DOM node, matching the browser
      input.focus();
    });
    fireEvent.change(input, { target: { value: 'ap' } });
    const listbox = await screen.findByRole('listbox');
    const option = firstOption(listbox);

    // Queue the pick, then type the next character. `RaceInjector`'s layout
    // effect (re-run by this same commit) fires the queued pick BEFORE this
    // commit's own `useLocalFilter` effect — which is closed over THIS
    // render's `userClosedDropdown === false` — gets to run.
    pendingPickRef.current = () => clickPick(option);
    fireEvent.change(input, { target: { value: 'app' } });

    // FAILS on unfixed `useAutocomplete.ts`: the pick's `setOpen(false)`
    // (useAutocomplete.ts:223) lands first (from inside the layout effect),
    // then the keystroke's stale effect calls `maybeAutoOpen`'s
    // `a.setOpen(true)` (useAutocomplete.ts:138) — and nothing closes it
    // again, since `maybeAutoOpen` only ever opens (useAutocomplete.ts:
    // 130-140).
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('stays closed when an Enter pick lands while the keystroke effect is still pending, in sync mode', async () => {
    const pendingPickRef = React.createRef<(() => void) | null>() as React.RefObject<(() => void) | null>;
    render(<SyncHarness pendingPickRef={pendingPickRef} />);
    const input = screen.getByRole('combobox', { name: 'cliente' });
    await act(async () => {
      // eslint-disable-next-line test-flakiness/no-focus-check, test-flakiness/await-async-events -- real synchronous focus, matching the browser
      input.focus();
    });
    fireEvent.change(input, { target: { value: 'ap' } });
    await screen.findByRole('listbox');
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // activeIndex -> 0, so Enter below picks it

    pendingPickRef.current = () => fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.change(input, { target: { value: 'app' } });

    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('stays closed when a click pick lands while the keystroke effect is still pending, in async (isLoading) mode', async () => {
    const pendingPickRef = React.createRef<(() => void) | null>() as React.RefObject<(() => void) | null>;
    render(<AsyncHarness pendingPickRef={pendingPickRef} />);
    const input = screen.getByRole('combobox', { name: 'cliente' });
    // `useLoadingOpen` opens on mount: `isLoading` is true and `inputValue`
    // ('ap') is non-empty.
    const listbox = await screen.findByRole('listbox');
    const option = firstOption(listbox);

    // Same technique, through `useLoadingOpen` this time: it also closes
    // over `userClosedDropdown` from the render that scheduled it, and has
    // no local-filter effect to settle first in async mode.
    pendingPickRef.current = () => clickPick(option);
    fireEvent.change(input, { target: { value: 'app' } });

    // FAILS on unfixed `useAutocomplete.ts`: the keystroke's `useLoadingOpen`
    // effect still reads its stale, captured `userClosedDropdown === false`
    // — `isLoading` never changes here, so nothing else invalidates it —
    // and calls `setOpen(true)` (useAutocomplete.ts:109) after the pick's
    // own `setOpen(false)`.
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });
});
