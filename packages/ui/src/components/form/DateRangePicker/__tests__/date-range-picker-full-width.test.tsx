// @vitest-environment jsdom
/**
 * `fullWidth` with `fieldsPlacement="beside"` (FUT-4156, round 2): the months'
 * frame meets the picker's edges. Under the fields it spans the picker; beside
 * them it takes the row the fields' column leaves, and that column stops at 320
 * design px. Without it the frame hugs its months, centred, as before.
 */
import { render, screen, within } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ThemeProvider, createTheme } from '../../../../mui/styles';
import { DateRangePicker } from '../DateRangePicker';
import type { DateRangePickerProps } from '../DateRangePicker.types';

const theme = createTheme();
const r = (px: number) => theme.typography.pxToRem(px);
const TEST_ID = 'drp';

/** Every element the picker measures reports `width` px. */
function pickerWidth(width: number): void {
  class FixedWidthObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element): void {
      this.callback([{ target, contentRect: { width } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal('ResizeObserver', FixedWidthObserver);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function mount(props: Partial<DateRangePickerProps> = {}): void {
  render(
    <ThemeProvider theme={theme}>
      <DateRangePicker
        value={{ from: null, to: null }}
        onChange={() => undefined}
        quickRanges={[]}
        numberOfMonths={2}
        fieldsPlacement="beside"
        dataTestId={TEST_ID}
        renderFields={() => <div data-testid="own-fields" />}
        {...props}
      />
    </ThemeProvider>,
  );
}

const picker = (): HTMLElement => screen.getByTestId(TEST_ID);
const frame = (): CSSStyleDeclaration =>
  getComputedStyle(within(picker()).getByTestId('calendar-container').parentElement!.parentElement!);
const fieldsColumn = (): CSSStyleDeclaration => getComputedStyle(screen.getByTestId('own-fields').parentElement!);

describe('fullWidth off (the default)', () => {
  it('FW1: under the fields the frame is as wide as its months, centred', () => {
    pickerWidth(500);
    mount();
    expect(picker().getAttribute('data-fields-placement')).toBe('below');
    expect(frame().alignSelf).toBe('center');
    expect(frame().width).toBe('fit-content');
  });
});

describe('fullWidth', () => {
  it('FW2: under the fields the frame spans the picker, and the calendar fills it', () => {
    pickerWidth(500);
    mount({ fullWidth: true });
    expect(frame().alignSelf).toBe('stretch');
    expect(frame().width).not.toBe('fit-content');
    expect(getComputedStyle(screen.getByTestId('calendar-container')).width).toBe('100%');
  });

  it('FW3: beside the fields the frame takes the rest of the row, never less than its months', () => {
    pickerWidth(1400);
    mount({ fullWidth: true });
    expect(picker().getAttribute('data-fields-placement')).toBe('beside');
    expect(frame().flex).toBe('1 1 auto');
    expect(frame().minWidth).toBe(r(666));
  });

  it("FW4: beside the months the fields' column stops at 320 design px", () => {
    pickerWidth(1400);
    mount({ fullWidth: true });
    expect(fieldsColumn().width).toBe(r(320));
    expect(fieldsColumn().flex).toBe('0 1 auto');
  });
});

/** Every rule block Emotion emitted for one of the element's own classes, bodies only. */
function ownRules(element: Element): string {
  const css = [...document.querySelectorAll('style')].map((tag) => tag.textContent ?? '').join('\n');
  const own = [...element.classList].filter((name) => name.startsWith('css-'));
  return css
    .split('}')
    .filter((block) => own.some((name) => block.trimStart().startsWith(`.${name}{`)))
    .map((block) => block.slice(block.indexOf('{') + 1))
    .join(';');
}

const frameElement = (): Element => within(picker()).getByTestId('calendar-container').parentElement!.parentElement!;

describe('round 3 (FUT-4156)', () => {
  it('FW5b: a host that states a raised surface gets it on the frame', () => {
    pickerWidth(500);
    const raised = createTheme({ uiSurfaces: { raised: '#fafbf9' } });
    render(
      <ThemeProvider theme={raised}>
        <DateRangePicker
          value={{ from: null, to: null }}
          onChange={() => undefined}
          quickRanges={[]}
          fieldsPlacement="beside"
          dataTestId={TEST_ID}
          renderFields={() => <div />}
          fullWidth
        />
      </ThemeProvider>,
    );
    expect(ownRules(frameElement())).toContain('background-color:#fafbf9');
  });

  it('FW5: the in-page frame is a card: the paper surface and the default Card radius', () => {
    pickerWidth(500);
    mount({ fullWidth: true });
    const rules = ownRules(frameElement());
    const expected = createTheme();
    expect(rules).toContain(`background-color:${expected.palette.background.paper}`);
    expect(rules).toContain(`border-radius:${expected.spacing(1)}`);
  });

  it('FW6: under the fields the frame trims its side padding so seven columns keep 40 design px', () => {
    pickerWidth(320);
    mount({ fullWidth: true });
    const rules = ownRules(frameElement()).replace(/\s/g, '');
    const pad = `clamp(0px,calc((100%-${r(282)})/2),${createTheme().spacing(2)})`;
    expect(rules).toContain(`padding-left:${pad}`);
    expect(rules).toContain(`padding-right:${pad}`);
  });

  it('FW7: fullWidth in the popover layout leaves the calendar as wide as its months', () => {
    render(
      <ThemeProvider theme={theme}>
        <DateRangePicker
          value={{ from: null, to: null }}
          onChange={() => undefined}
          quickRanges={[]}
          numberOfMonths={2}
          dataTestId="popover"
          fullWidth
        />
      </ThemeProvider>,
    );
    const calendar = within(screen.getByTestId('popover')).getByTestId('calendar-container');
    expect(getComputedStyle(calendar).width).not.toBe('100%');
    expect(getComputedStyle(within(calendar).getByTestId('calendar-month-0')).maxWidth).toBe(r(304));
  });
});
