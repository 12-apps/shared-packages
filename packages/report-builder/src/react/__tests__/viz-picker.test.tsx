// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { ChartKind } from '../builder-model';
import { VizPicker } from '../viz-picker';

/**
 * `plan.md` entry 14's acceptance is "every disabled option has a visible
 * reason, not just a grey state" — and the first implementation of that
 * printed EVERY blocked reason at once, six lines in a 344px panel, five of
 * them the same sentence.
 *
 * So the acceptance is now met on demand rather than always: the reason
 * appears on hover, on keyboard focus, and on activating the tile, one at a
 * time — and, with no interaction at all, as the tile's accessible
 * DESCRIPTION. That last one is the part a hover-only tooltip would lose, so
 * it is asserted as a computed description rather than as text present
 * somewhere in the DOM.
 *
 * The tiles are `aria-disabled`, not `disabled`, for the same reason: a
 * genuinely disabled button leaves the tab order and swallows pointer events,
 * which would put the explanation behind an interaction the people who most
 * need it cannot perform.
 */

const REASON_KPI = 'Um número único não usa agrupamento. Tire o “agrupar por” para escolher.';
const REASON_PIE = 'Pizza e rosca mostram a composição de uma série só.';

interface Option {
  value: ChartKind;
  label: string;
  disabledReason: string | null;
}

/** A fresh list per test — nothing here may outlive the test that read it. */
function vizOptions(): Option[] {
  return [
    { value: 'kpi', label: 'Número', disabledReason: REASON_KPI },
    { value: 'line', label: 'Linha', disabledReason: null },
    { value: 'bar', label: 'Barras', disabledReason: null },
    { value: 'area', label: 'Área', disabledReason: null },
    { value: 'table', label: 'Tabela', disabledReason: null },
    { value: 'pie', label: 'Pizza', disabledReason: REASON_PIE },
    { value: 'donut', label: 'Rosca', disabledReason: REASON_PIE },
  ];
}

/** Render the picker and hand back the selection spy. */
function renderPicker(value: ChartKind = 'bar'): ReturnType<typeof vi.fn> {
  const onChange = vi.fn();
  render(<VizPicker options={vizOptions()} value={value} onChange={onChange} />);
  return onChange;
}

const tile = (kind: ChartKind): HTMLElement => screen.getByTestId(`builder-chart-type-${kind}`);

/**
 * The description a screen reader would resolve, without jest-dom — this
 * package's suites use plain vitest matchers. `aria-describedby` wins when its
 * target is on screen; `title` is the fallback that needs no interaction.
 */
function accessibleDescription(element: HTMLElement): string {
  const ids = element.getAttribute('aria-describedby');
  if (ids !== null) {
    const text = ids
      .split(/\s+/)
      .map((id) => element.ownerDocument.getElementById(id)?.textContent ?? '')
      .join(' ')
      .trim();
    if (text !== '') return text;
  }
  return element.getAttribute('title')?.trim() ?? '';
}

/** Every reason currently rendered as a callout, read straight off the DOM. */
function calloutTexts(): string[] {
  return screen
    .queryAllByTestId(/^builder-chart-type-.+-reason$/)
    .map((element) => element.textContent ?? '');
}

afterEach(cleanup);

describe('at rest, the picker explains nothing', () => {
  it('renders no reason until one is asked for', () => {
    renderPicker();
    expect(calloutTexts()).toEqual([]);
  });

  it('still renders every option, blocked ones included', () => {
    renderPicker();
    expect(vizOptions().map((option) => tile(option.value).textContent)).toEqual([
      'Número',
      'Linha',
      'Barras',
      'Área',
      'Tabela',
      'Pizza',
      'Rosca',
    ]);
  });
});

describe('a blocked tile explains itself, four ways', () => {
  it('carries its reason as an accessible description with no interaction at all', () => {
    renderPicker();
    // The route that survives for a screen reader, a touch device and anyone
    // who never hovers. A hover-only tooltip is exactly what this forbids.
    expect(accessibleDescription(tile('pie'))).toBe(REASON_PIE);
    expect(accessibleDescription(tile('kpi'))).toBe(REASON_KPI);
  });

  it('shows the reason on pointer hover', () => {
    renderPicker();
    fireEvent.mouseEnter(tile('kpi'));
    expect(calloutTexts()).toEqual([`Número: ${REASON_KPI}`]);
  });

  it('shows the reason on keyboard focus', async () => {
    renderPicker();
    // `focusIn`, the event React's onFocus delegation actually listens for —
    // and, unlike a bare `.focus()`, dispatched inside `act`.
    fireEvent.focusIn(tile('donut'));
    await waitFor(() => {
      expect(calloutTexts()).toEqual([`Rosca: ${REASON_PIE}`]);
    });
  });

  it('shows the reason on activation, and keeps it after the pointer leaves', async () => {
    renderPicker();
    fireEvent.click(tile('kpi'));
    expect(calloutTexts()).toEqual([`Número: ${REASON_KPI}`]);

    fireEvent.mouseLeave(tile('kpi'));
    await waitFor(() => {
      expect(calloutTexts()).toEqual([`Número: ${REASON_KPI}`]);
    });
  });

  it('explains ONE option at a time — clicking Número does not also explain Rosca', () => {
    renderPicker();
    fireEvent.click(tile('kpi'));
    expect(calloutTexts()).toHaveLength(1);
    expect(screen.queryAllByTestId('builder-chart-type-donut-reason')).toEqual([]);
  });

  it('hands the description to the callout once it is on screen', async () => {
    renderPicker();
    fireEvent.focusIn(tile('pie'));
    // Same sentence either way; what changes is that it now resolves through
    // the live element rather than through `title`.
    await waitFor(() => {
      expect(tile('pie').getAttribute('aria-describedby')).toBe('builder-chart-type-pie-reason');
    });
    expect(accessibleDescription(tile('pie'))).toContain(REASON_PIE);
  });
});

describe('a blocked tile stays reachable, and selects nothing', () => {
  it('is aria-disabled rather than disabled, so it keeps focus and hover', () => {
    renderPicker();
    expect(tile('pie').getAttribute('aria-disabled')).toBe('true');
    expect((tile('pie') as HTMLButtonElement).disabled).toBe(false);
  });

  it('does not change the selection when activated', () => {
    const onChange = renderPicker();
    fireEvent.click(tile('pie'));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('an available tile carries no reason at all', () => {
  it('has no description and no callout, hovered or clicked', async () => {
    const onChange = renderPicker();
    expect(accessibleDescription(tile('line'))).toBe('');

    fireEvent.mouseEnter(tile('line'));
    fireEvent.click(tile('line'));

    expect(onChange).toHaveBeenCalledWith('line');
    await waitFor(() => {
      expect(calloutTexts()).toEqual([]);
    });
  });

  it('clears a pinned reason once a real choice is made', async () => {
    renderPicker();
    fireEvent.click(tile('kpi'));
    expect(calloutTexts()).toHaveLength(1);

    fireEvent.click(tile('bar'));
    await waitFor(() => {
      expect(calloutTexts()).toEqual([]);
    });
  });

  it('marks the current selection as pressed, and only that one', () => {
    renderPicker('area');
    const pressed = vizOptions().filter(
      (option) => tile(option.value).getAttribute('aria-pressed') === 'true',
    );
    expect(pressed.map((option) => option.value)).toEqual(['area']);
  });
});
