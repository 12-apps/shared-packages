import { ThemeProvider, createTheme } from '@mui/material/styles/index.js';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React, { useState } from 'react';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PT_BR_AUTOCOMPLETE_COPY } from '../../../../pt-BR';
import { Autocomplete } from '../Autocomplete';

/**
 * FUT-2779 #2: a touch-driven pick still closes the list (jsdom half).
 *
 * Same record as `Autocomplete.test.stories.tsx`'s `TouchPick` story (real
 * Chromium, `userEvent.pointer`'s touch pointer): this is the fast jsdom
 * counterpart, expressing the touch sequence with jsdom's own `TouchEvent`
 * (real in this jsdom version) around the `mousedown`/`click` pair that
 * actually drives a pick — `Autocomplete` has no dedicated touch handler, so
 * a real touch tap reaches it exactly the way a real mobile browser's
 * touch-to-mouse compatibility events do.
 *
 * The mobile-browser quirk this ticket worried about — `touchstart` blurring
 * the focused input, which could let the pick's own refocus re-run `onFocus`
 * and reopen the list — was investigated with Playwright touch emulation
 * (`hasTouch`/`isMobile` context, `.tap()` and raw CDP
 * `Input.dispatchTouchEvent`) and did not reproduce in that Chromium build:
 * `document.activeElement` never left the input. jsdom does not implement
 * that native blur-on-touchstart behaviour either, so this test is a passing
 * regression guard — the same outcome FUT-2763/FUT-2780 already lock in for
 * a mouse pick, now driven by touch-typed events — not a reproduction of the
 * unconfirmed reopen.
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

function SyncHarness(): React.JSX.Element {
  const [value, setValue] = useState('');
  return (
    <ThemeProvider theme={theme}>
      <Autocomplete<Row>
        copy={PT_BR_AUTOCOMPLETE_COPY}
        value={value}
        onChange={setValue}
        suggestions={ROWS}
        getKey={(row) => row.id}
        getLabel={(row) => row.label}
        inputAriaLabel="cliente"
        // Long enough that the debounced round-trip never lands mid-test —
        // see the same harness's comment in autocomplete-closes-after-pick.test.tsx.
        debounceMs={100000}
      />
    </ThemeProvider>
  );
}

function firstOption(listbox: HTMLElement): HTMLElement {
  const option = within(listbox).getAllByRole('option')[0];
  if (!option) throw new Error('expected at least one option in the listbox');
  return option;
}

/**
 * A real touch tap on `target`: `touchstart` then `touchend` (jsdom's own,
 * real `TouchEvent` — no `Touch`/`PointerEvent` constructor is needed for a
 * bubbling touch event to fire), followed by the `mousedown`/`click` pair a
 * real mobile browser derives from that same tap and that `Autocomplete`'s
 * option actually listens to.
 */
function touchTap(target: HTMLElement): void {
  target.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true }));
  target.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true }));
  fireEvent.mouseDown(target);
  fireEvent.click(target);
}

describe('Autocomplete: a touch-driven pick still closes the list (FUT-2779 #2)', () => {
  it('closes on a touch tap pick and holds the picked label', async () => {
    render(<SyncHarness />);
    const input = screen.getByRole('combobox', { name: 'cliente' });
    await act(async () => {
      // eslint-disable-next-line test-flakiness/no-focus-check, test-flakiness/await-async-events -- real synchronous focus so the pick's own refocus is a true no-op, matching the browser
      input.focus();
    });
    fireEvent.change(input, { target: { value: 'ap' } });

    const listbox = await screen.findByRole('listbox');
    const option = firstOption(listbox);

    act(() => {
      touchTap(option);
    });

    expect(input).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(input).toHaveValue('Apple');
  });
});
