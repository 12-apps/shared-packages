import { ThemeProvider, createTheme } from '@mui/material/styles/index.js';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import React, { useState } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { PT_BR_AUTOCOMPLETE_COPY } from '../../../../pt-BR';
import { Autocomplete } from '../Autocomplete';

/**
 * FUT-2860: the pick's OWN correction is also debounced.
 *
 * FUT-2779 made a pick cancel a STILL-PENDING keystroke timer, closing the
 * case where that timer fires AFTER the pick. It cannot help when the timer
 * has ALREADY fired before the pick starts: the keystroke's `p.onChange` has
 * already reached the host, which may round-trip its own `value` prop back
 * down asynchronously. `commitSingleSelect` used to correct the input by
 * calling the SAME `debouncedOnChange` a keystroke uses — so its own
 * correction was itself delayed by up to `debounceMs`, leaving a window in
 * which the host's stale round trip can land, through `useValueSync`'s plain
 * passive effect, and overwrite the just-picked label back to the typed text.
 *
 * `Harness` below models that round trip explicitly and deliberately DEFERS
 * it (via `pendingHostUpdateRef`, queued instead of applied) rather than
 * letting React apply it inline — mirroring FUT-2780's own finding that a
 * plain `fireEvent`/`act` pair settles a render's effects fully before the
 * next `fireEvent` runs, leaving no window to race into on unfixed code
 * without deliberately holding one open. The test then:
 *   1. types a character (arms a debounce),
 *   2. advances timers so it fires (`p.onChange(typedText)` is observed, but
 *      the host's OWN re-render from it is queued, not yet applied),
 *   3. picks an item BEFORE that host re-render lands,
 *   4. THEN flushes the queued host round trip.
 *
 * On today's code, the pick's own `onChange(label)` call goes through
 * `debouncedOnChange`, so nothing overwrites the queued round trip's
 * `() => setValue(typedText)` before it is flushed — flushing it re-renders
 * the host with the STALE `value`, which `useValueSync` copies back into the
 * input, undoing the pick (fails). After the fix, `commitSingleSelect` calls
 * `p.onChange(label)` directly and synchronously, so the host's queued update
 * is overwritten with `() => setValue(label)` before it is ever flushed.
 */

const theme = createTheme();

interface Row {
  id: string;
  label: string;
}

const ROWS: Row[] = [
  { id: '1', label: 'Apple' },
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

/**
 * A host that round-trips `value` through props, like `grant-fields.tsx`'s
 * `setQuery` does — but queues the round trip in a ref instead of applying it
 * inline, so the test can choose exactly when it lands relative to a pick.
 */
function Harness({
  onChange,
  pendingHostUpdateRef,
}: {
  onChange: (val: string) => void;
  pendingHostUpdateRef: React.RefObject<(() => void) | null>;
}): React.JSX.Element {
  const [value, setValue] = useState('');
  return (
    <ThemeProvider theme={theme}>
      <Autocomplete<Row>
        copy={PT_BR_AUTOCOMPLETE_COPY}
        value={value}
        onChange={(val) => {
          onChange(val);
          pendingHostUpdateRef.current = () => setValue(val);
        }}
        suggestions={ROWS}
        getKey={(row) => row.id}
        getLabel={(row) => row.label}
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

describe("Autocomplete: a pick's own correction is not debounced (FUT-2860)", () => {
  it('shows the picked label, and delivers it, even after an already-fired keystroke round trip lands late', () => {
    vi.useFakeTimers();
    try {
      const onChange = vi.fn();
      const pendingHostUpdateRef = React.createRef<(() => void) | null>() as React.RefObject<(() => void) | null>;
      render(<Harness onChange={onChange} pendingHostUpdateRef={pendingHostUpdateRef} />);
      const input = screen.getByRole('combobox', { name: 'cliente' });

      // `waitFor(() => expect(input).toHaveFocus())` cannot pair with this
      // focus: `@testing-library/react`'s `waitFor` wraps its check in
      // React's own `act`, whose scheduler flush this suite's
      // `vi.useFakeTimers()` also fakes — so even an already-true check never
      // settles, and the test hangs to vitest's own timeout instead of
      // asserting anything (verified empirically against this exact file).
      act(() => {
        // eslint-disable-next-line test-flakiness/no-focus-check, test-flakiness/await-async-events -- real synchronous focus; waitFor hangs under this suite's fake timers (see comment above)
        input.focus();
      });
      fireEvent.change(input, { target: { value: 'ap' } }); // arms a 150ms timer

      act(() => {
        vi.advanceTimersByTime(150); // the keystroke's debounce fires
      });
      // `p.onChange('ap')` was observed, but the host's OWN re-render from it
      // is queued, not yet applied — `value` prop is still the initial ''.
      expect(onChange).toHaveBeenLastCalledWith('ap');

      const listbox = screen.getByRole('listbox');
      const option = firstOption(listbox); // 'Apple'
      act(() => {
        fireEvent.mouseDown(option);
        fireEvent.click(option); // picks it, BEFORE the queued round trip lands
      });

      // Flush the host's queued round trip now — late, after the pick.
      act(() => {
        pendingHostUpdateRef.current?.();
      });

      // FAILS on unfixed `useAutocomplete.ts`: `commitSingleSelect`'s own
      // `onChange('Apple')` call went through `debouncedOnChange`, so it
      // never overwrote the queued `() => setValue('ap')` before this flush
      // ran it — `useValueSync` copies the stale 'ap' back into the input,
      // undoing the pick.
      expect(input).toHaveValue('Apple');
      expect(onChange).toHaveBeenLastCalledWith('Apple');
    } finally {
      vi.useRealTimers();
    }
  });
});
