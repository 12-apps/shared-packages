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
import Popover from '@mui/material/Popover/index.js';
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

/**
 * Gives `useClickAway`'s deferred `setTimeout(0)` decision its turn (FUT-2776:
 * the document listener is capture-phase, which fires before the card's own
 * `onPointerDownCapture` ownership marker further down the tree, so the
 * decision is deferred). It is a macrotask, not a microtask — a microtask
 * queued from a capture-phase listener runs BEFORE the rest of the capture
 * dispatch for TRUSTED input, so it would read the marker before it is set
 * (see `useClickAway`'s comment in `HoverCard.hooks.ts` for the measured
 * ordering). Fake timers fake `setTimeout`, so `runOnlyPendingTimers` gives
 * it its turn directly.
 */
const flushClickAway = async () => {
  // The click-away decision's own deferred timer.
  runTimers();
  // The popover unmounts its content only once MUI's exit transition ends,
  // which runs on a SEPARATE (fake) timer of its own, scheduled only once
  // the state update above has taken effect.
  runTimers();
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

/**
 * An UNRELATED portal — not anything the card's own `content` renders — that
 * mounts to `document.body` only once its own `anchorEl` state is set, so the
 * test controls exactly when it appears relative to the card opening. It is
 * a sibling of the card in the React tree, never a descendant.
 */
function UnrelatedPortalHarness() {
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);

  return (
    <>
      <HoverCard
        title="Preferências"
        loadingText="Carregando…"
        enterDelay={ENTER}
        exitDelay={0}
        trigger={<button type="button">gatilho</button>}
      >
        conteúdo do cartão
      </HoverCard>
      <button
        type="button"
        data-testid="mount-unrelated-portal"
        onClick={(event) => setAnchorEl(event.currentTarget)}
      >
        montar aviso
      </button>
      <Popover open={Boolean(anchorEl)} anchorEl={anchorEl}>
        <button type="button" data-testid="unrelated-portal-button">
          ação do aviso
        </button>
      </Popover>
    </>
  );
}

function renderCardWithUnrelatedPortal() {
  const { unmount } = render(<UnrelatedPortalHarness />);
  return {
    trigger: screen.getByTestId('hover-card-trigger'),
    mountUnrelatedPortal: screen.getByTestId('mount-unrelated-portal'),
    unmount,
  };
}

describe('HoverCard: click-away inside a nested portal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a pointerdown on an option inside the nested Select does not close the card', async () => {
    const { trigger } = renderCardWithNestedSelect();
    openByHover(trigger);

    openNestedSelect();
    const option = screen.getByRole('option', { name: 'Opção B' });

    fireEvent.pointerDown(option);
    await flushClickAway();

    expect(openCards()).toBe(1);
  });

  it("the nested Select's own selection still works after the press is let through", async () => {
    const { trigger, onChange } = renderCardWithNestedSelect();
    openByHover(trigger);

    openNestedSelect();
    const option = screen.getByRole('option', { name: 'Opção B' });

    fireEvent.pointerDown(option);
    fireEvent.click(option);
    await flushClickAway();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(openCards()).toBe(1);
  });

  it('a pointerdown truly outside the card and the nested portal still closes it', async () => {
    const { trigger, outside } = renderCardWithNestedSelect();
    openByHover(trigger);

    openNestedSelect();
    // The menu is open (the portal exists) when the outside press lands.
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    fireEvent.pointerDown(outside);
    await flushClickAway();

    expect(openCards()).toBe(0);
  });

  /**
   * NEGATIVE (FUT-2776 adversarial review): the fix must attribute a press by
   * OWNERSHIP — is the pressed element part of the card's own React tree? —
   * not by TIMING. An unrelated portal (a Snackbar, a dev overlay, another
   * component's Popover) that happens to mount to `document.body` while the
   * card is open is not the card's, and a press inside it must still close
   * the card, exactly like any other outside press.
   */
  it('a pointerdown inside an UNRELATED portal mounted while the card is open still closes it', async () => {
    const { trigger, mountUnrelatedPortal } = renderCardWithUnrelatedPortal();
    openByHover(trigger);

    // Mounted AFTER the card is already open — the same timing a
    // timing-based "everything appended to body while open is inside" check
    // would (wrongly) treat as owned by the card.
    fireEvent.click(mountUnrelatedPortal);
    const unrelatedButton = screen.getByTestId('unrelated-portal-button');

    fireEvent.pointerDown(unrelatedButton);
    await flushClickAway();

    expect(openCards()).toBe(0);
  });
});

/**
 * A control inside the card's OWN nested portal whose `onPointerDown` stops
 * NATIVE propagation before it can reach any document-level listener — the
 * pattern used by anything that treats the press as its own gesture (a MUI
 * `Select`'s own internals, a custom menu item, ...). It is owned by the
 * card in the REACT tree, so `useCardOwnership`'s capture-phase marker (an
 * ANCESTOR of the portal, unaffected by a `stopPropagation` a descendant
 * calls later) still runs for it — the marker does not depend on the event
 * ever reaching `useClickAway`'s own listener at all.
 */
function StoppingNestedControlHarness() {
  const [menuAnchor, setMenuAnchor] = React.useState<HTMLElement | null>(null);

  return (
    <>
      <HoverCard
        title="Preferências"
        loadingText="Carregando…"
        enterDelay={ENTER}
        exitDelay={0}
        trigger={<button type="button">gatilho</button>}
      >
        <button
          type="button"
          data-testid="open-nested-menu"
          onClick={(event) => setMenuAnchor(event.currentTarget)}
        >
          abrir menu aninhado
        </button>
        <Popover open={Boolean(menuAnchor)} anchorEl={menuAnchor}>
          <button
            type="button"
            data-testid="stops-propagation"
            onPointerDown={(event) => event.stopPropagation()}
          >
            opção que para a propagação
          </button>
        </Popover>
      </HoverCard>
      <button type="button">fora</button>
    </>
  );
}

function renderCardWithStoppingNestedControl() {
  const { unmount } = render(<StoppingNestedControlHarness />);
  return {
    trigger: screen.getByTestId('hover-card-trigger'),
    outside: screen.getByText('fora'),
    unmount,
  };
}

describe('HoverCard: click-away ownership does not go stale (FUT-2776 adversarial review)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * PINS THE STALE-FLAG REGRESSION. A boolean "was the last press inside"
   * flag, cleared only when `useClickAway`'s own listener runs, never got
   * cleared here: the stopping press's native propagation never reached
   * that listener, so the flag stayed `true` and the NEXT, genuinely
   * outside press read it as still "inside" and left the card open. A
   * `WeakSet` keyed on the native event itself cannot leak this way — the
   * outside press is a different event, present in nobody's set.
   */
  it('a stopped press inside the nested portal does not leave a later, truly outside press wrongly classified as inside', async () => {
    const { trigger, outside } = renderCardWithStoppingNestedControl();
    openByHover(trigger);

    fireEvent.click(screen.getByTestId('open-nested-menu'));
    const stopper = screen.getByTestId('stops-propagation');

    fireEvent.pointerDown(stopper);
    await flushClickAway();
    // Owned by the card's own React tree: still open after the stopping press.
    expect(openCards()).toBe(1);

    fireEvent.pointerDown(outside);
    await flushClickAway();
    // The stale flag would have kept this open too. It must not.
    expect(openCards()).toBe(0);
  });
});
