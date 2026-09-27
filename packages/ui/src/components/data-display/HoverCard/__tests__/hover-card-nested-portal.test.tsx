/**
 * A PRESS INSIDE THE CARD'S OWN NESTED PORTAL DOES NOT CLOSE IT (FUT-2776).
 *
 * `useClickAway` used to know only two elements: the trigger and the card's
 * own content box (`HoverCard.hooks.ts`'s old `insideCard`). If `content`
 * rendered something that opens in its OWN portal — a MUI `Select`'s menu, a
 * nested `Popover`, a `DropdownMenu` — that portal's root is appended near
 * `document.body`, outside both tracked elements. A press inside it (picking
 * a `Select` option) did not `.contains()` either one, so the capture-phase
 * `pointerdown` listener fell through to `onAway` and closed the card —
 * taking the nested control's own menu down with it.
 *
 * The fix tracks whatever the card's content portals to `document.body`
 * while the card is open, and treats a press inside any of it as inside the
 * card too. It is generic: nothing here names `Select` specifically, so a
 * `Popover` or a `DropdownMenu` in its place needs no separate wiring.
 */
import MenuItem from '@mui/material/MenuItem/index.js';
import Select from '@mui/material/Select/index.js';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HoverCard } from '../HoverCard';

const ENTER = 100;

function renderCardWithNestedSelect() {
  const onChange = vi.fn();
  const { unmount } = render(
    <>
      <HoverCard
        title="Preferências"
        loadingText="Carregando…"
        enterDelay={ENTER}
        exitDelay={0}
        trigger={<button type="button">gatilho</button>}
      >
        <Select
          data-testid="nested-select"
          labelId="nested-select-label"
          defaultValue=""
          onChange={onChange}
        >
          <MenuItem value="a">Opção A</MenuItem>
          <MenuItem value="b">Opção B</MenuItem>
        </Select>
      </HoverCard>
      <button type="button">fora</button>
    </>,
  );
  return {
    trigger: screen.getByTestId('hover-card-trigger'),
    outside: screen.getByText('fora'),
    onChange,
    unmount,
  };
}

/** How many cards are mounted: 0 closed, 1 open. */
const openCards = () => screen.queryAllByTestId('hover-card-content').length;

const runTimers = () => {
  act(() => {
    vi.runOnlyPendingTimers();
  });
};

function openByHover(trigger: HTMLElement) {
  fireEvent.mouseEnter(trigger);
  runTimers();
  expect(openCards()).toBe(1);
}

/** Opens the nested Select's menu — a real portal, appended near `document.body`. */
function openNestedSelect() {
  const combobox = screen.getByTestId('nested-select').querySelector('[role="combobox"]');
  expect(combobox).not.toBeNull();
  fireEvent.mouseDown(combobox as Element);
}

describe('HoverCard: click-away inside a nested portal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a pointerdown on an option inside the nested Select does not close the card', () => {
    const { trigger } = renderCardWithNestedSelect();
    openByHover(trigger);

    openNestedSelect();
    const option = screen.getByRole('option', { name: 'Opção B' });

    fireEvent.pointerDown(option);
    runTimers();

    expect(openCards()).toBe(1);
  });

  it("the nested Select's own selection still works after the press is let through", () => {
    const { trigger, onChange } = renderCardWithNestedSelect();
    openByHover(trigger);

    openNestedSelect();
    const option = screen.getByRole('option', { name: 'Opção B' });

    fireEvent.pointerDown(option);
    fireEvent.click(option);
    runTimers();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(openCards()).toBe(1);
  });

  it('a pointerdown truly outside the card and the nested portal still closes it', () => {
    const { trigger, outside } = renderCardWithNestedSelect();
    openByHover(trigger);

    openNestedSelect();
    // The menu is open (the portal exists) when the outside press lands.
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    fireEvent.pointerDown(outside);
    runTimers();

    expect(openCards()).toBe(0);
  });
});
