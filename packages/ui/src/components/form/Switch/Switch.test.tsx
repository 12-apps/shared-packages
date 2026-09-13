/**
 * THE SWITCH'S NAME, ITS TARGET, AND THE INK ON ITS TRACK.
 *
 * Two defects, one component, and both were invisible to a grep of the callers:
 * every consumer passed a `label` and the label was right there in the source.
 * Only the rendered tree disagreed (FUT-1905, FUT-1924).
 *
 *   - The label was a `<p>` rendered as the input's SIBLING. No `for`, no `id`,
 *     no `aria-labelledby` — so the control announced as "checkbox, checked"
 *     with no name, and the words beside it did nothing when clicked.
 *   - The thumb, the `on` wording and the on-icon all stated `#fff`, over a
 *     track painted `palette.main` — the one surface a white-labelled host
 *     picks. A pale brand got a white knob on a pale bar: the switch reads as
 *     OFF while it is on, which is a state a user misreads rather than a colour
 *     they dislike.
 *
 * The ink cases assert the EMITTED CSS rather than `getComputedStyle`, for the
 * reason `field-contrast.test.tsx` sets out at length: the thumb's colour is
 * declared by a descendant rule and jsdom does not resolve that cascade
 * reliably. What is worth pinning is the declaration the component makes.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { createTheme, ThemeProvider } from '@mui/material/styles/index.js';
import type { Theme } from '@mui/material/styles/index.js';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Switch } from './Switch';
import { TAP_TARGET_MIN } from './Switch.metrics';
import { onTrackInk } from './Switch.styles';

/** A real seeded tenant's brand: 1.76:1 against white, which is the whole point. */
const PALE_BRAND = '#7ED957';
const DARK_BRAND = '#1A237E';

/** MUI's own dark ink, which is what a pale fill has to be labelled with. */
const DARK_INK = 'rgba(0, 0, 0, 0.87)';

const themed = (main: string): Theme => createTheme({ palette: { primary: { main } } });

/** Every rule emotion has put in the document, as one string. */
function emittedCss(): string {
  return Array.from(document.querySelectorAll('style'))
    .map((tag) => tag.textContent ?? '')
    .join('\n');
}

/**
 * The declarations THIS render added, split into rules.
 *
 * The delta matters: emotion never removes a rule, so a component asserted
 * against the whole document passes on a colour a sibling emitted three cases
 * earlier.
 */
function rulesAddedBy(paint: () => void): string[] {
  const before = emittedCss().length;
  paint();
  return emittedCss().slice(before).split('}');
}

/**
 * The `background-color` the added rules give the thumb, in one of its states.
 *
 * Matched on the whole rule rather than "the first one mentioning the thumb":
 * the hover rule names `.MuiSwitch-thumb` too, declares no colour, and comes
 * first — a `find` without the `background-color` clause reads it and reports
 * `undefined` for a component that is painting correctly.
 */
function thumbFill(rules: string[], state: 'checked' | 'resting'): string | undefined {
  const rule = rules.find((candidate) => {
    const [selector = ''] = candidate.split('{');
    const checked = selector.includes('.Mui-checked');

    return (
      candidate.includes('.MuiSwitch-thumb{') &&
      candidate.includes('background-color') &&
      checked === (state === 'checked')
    );
  });

  return rule?.match(/background-color:([^;]+)/u)?.[1];
}

/** The thumb's fill while checked, from the rules THIS render added. */
function checkedThumbFill(paint: () => void): string | undefined {
  return thumbFill(rulesAddedBy(paint), 'checked');
}

describe('the label names the control (FUT-1905)', () => {
  it('gives the checkbox its accessible name from the visible words', () => {
    render(<Switch label="Modo escuro" />);

    expect(screen.getByRole('checkbox', { name: 'Modo escuro' })).toBeInTheDocument();
  });

  it('toggles when the LABEL is clicked, not only the knob', () => {
    const onChange = vi.fn();
    render(<Switch label="Modo escuro" onChange={onChange} />);

    fireEvent.click(screen.getByText('Modo escuro'));

    // The affordance every other labelled control on the web has, and the one
    // this component did not: before the fix the words were decoration.
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('points the label at the input it actually names', () => {
    render(<Switch label="Modo escuro" dataTestId="dark" />);

    const input = screen.getByTestId('dark');
    expect(screen.getByTestId('dark-label')).toHaveAttribute('for', input.getAttribute('id'));
    expect(input.getAttribute('id')).toBeTruthy();
  });

  it('does not let two switches share one id', () => {
    render(
      <>
        <Switch label="Ativo" dataTestId="a" />
        <Switch label="Ativo" dataTestId="b" />
      </>,
    );

    // A `dataTestId`-derived id would look unique until two call sites reused a
    // test id — and then the second label would toggle the FIRST control.
    expect(screen.getByTestId('a').getAttribute('id')).not.toBe(
      screen.getByTestId('b').getAttribute('id'),
    );
  });

  it('honours an id the caller chose', () => {
    render(<Switch label="Modo escuro" id="theme-mode" dataTestId="dark" />);

    expect(screen.getByTestId('dark')).toHaveAttribute('id', 'theme-mode');
    expect(screen.getByTestId('dark-label')).toHaveAttribute('for', 'theme-mode');
  });

  it('keeps the test id when the caller passes inputProps of its own', () => {
    // The bug that made the id wiring possible in the first place: `inputProps`
    // was written BEFORE `{...props}`, so a caller passing any of its own
    // replaced the whole object — losing the test id every spec finds this
    // control by, and any id the label pointed at.
    render(<Switch label="Modo escuro" dataTestId="dark" inputProps={{ name: 'dark-mode' }} />);

    const input = screen.getByTestId('dark');
    expect(input).toHaveAttribute('name', 'dark-mode');
    expect(input.getAttribute('id')).toBeTruthy();
  });
});

describe('the description, which is not part of the name', () => {
  it('is pointed at by aria-describedby rather than folded into the label', () => {
    render(<Switch label="Modo escuro" description="Segue o tema do seu sistema" dataTestId="dark" />);

    const input = screen.getByTestId('dark');
    // Named by the label alone — a two-line explanation read out as the
    // control's NAME is worse than no description at all.
    expect(screen.getByRole('checkbox', { name: 'Modo escuro' })).toBe(input);
    expect(document.getElementById(input.getAttribute('aria-describedby') ?? '')).toHaveTextContent(
      'Segue o tema do seu sistema',
    );
  });

  it('announces the helper line, which is where an error lands', () => {
    render(
      <Switch label="Modo escuro" error helperText="Indisponível nesta loja" dataTestId="dark" />,
    );

    const described = screen.getByTestId('dark').getAttribute('aria-describedby') ?? '';
    // Without this the control announced as "checkbox, checked" and nothing
    // else: the sentence saying WHY was on screen and out of the tree.
    expect(document.getElementById(described)).toHaveTextContent('Indisponível nesta loja');
  });

  it("keeps a caller's own aria-describedby alongside it", () => {
    render(
      <Switch
        label="Modo escuro"
        description="Segue o tema do seu sistema"
        aria-describedby="hint"
        dataTestId="dark"
      />,
    );

    expect(screen.getByTestId('dark').getAttribute('aria-describedby')).toMatch(/^hint /u);
  });
});

describe('the tap target (FUT-1905 §2)', () => {
  it('gives the label the floor no switch size can reach', () => {
    // `SWITCH_SIZES.xl` is 34px tall, so this cannot be bought by passing a
    // bigger `size` — the label is what clears 40.
    render(<Switch label="Modo escuro" dataTestId="dark" />);

    expect(screen.getByTestId('dark-label')).toHaveStyle({ minHeight: `${TAP_TARGET_MIN}px` });
  });

  it('leaves the row alone where a description already makes it taller', () => {
    render(<Switch label="Modo escuro" description="uma explicação" dataTestId="dark" />);

    expect(screen.getByTestId('dark-label')).not.toHaveStyle({ minHeight: `${TAP_TARGET_MIN}px` });
  });
});

describe('the ink on a tenant-coloured track (FUT-1924)', () => {
  it('labels a PALE brand with dark ink', () => {
    const fill = checkedThumbFill(() => {
      render(
        <ThemeProvider theme={themed(PALE_BRAND)}>
          <Switch checked />
        </ThemeProvider>,
      );
    });

    expect(fill).toBe(DARK_INK);
  });

  it('leaves a DARK brand white, which is what it always was', () => {
    const fill = checkedThumbFill(() => {
      render(
        <ThemeProvider theme={themed(DARK_BRAND)}>
          <Switch checked />
        </ThemeProvider>,
      );
    });

    // The half that proves this is a correction and not a repaint: a brand the
    // white knob was always right on keeps it.
    expect(fill).toBe('#fff');
  });

  it('hands the on-icon the same ink as the thumb it sits beside', () => {
    // The icons are drawn as components rather than styles, so they reach the
    // decision through `onTrackInk` — a second copy of the rule would be a
    // second thing to get wrong.
    expect(onTrackInk(themed(PALE_BRAND), {})).toBe(DARK_INK);
    expect(onTrackInk(themed(DARK_BRAND), {})).toBe('#fff');
  });

  it('reads the whole gradient BAR, not the colour at the middle of it', () => {
    /*
      `gradient` paints the track `light → main → dark`, so the thumb travels
      over all three. Judged by `main` alone this teal takes dark ink, at
      4.86:1 — and the bar's own dark end is `rgb(0, 95, 86)`, where that same
      ink is 2.78:1 and the white it replaced was 7.55:1. Over the whole bar
      white is the better worst case, so the flat track's answer is the wrong
      one to copy onto a gradient.
    */
    const teal = themed('#00897b');

    expect(onTrackInk(teal, {})).toBe(DARK_INK);
    expect(onTrackInk(teal, { gradient: true })).toBe('#fff');
  });

  it('keeps the RESTING thumb white, over a track no tenant picked', () => {
    /*
      The same pale brand on a DARK page, which is a theme no case above has
      rendered — emotion emits a rule once per hash, so re-rendering a
      combination already on screen adds nothing to the delta and the rule would
      be looked for in an empty string.
    */
    const rules = rulesAddedBy(() => {
      render(
        <ThemeProvider theme={createTheme({ palette: { mode: 'dark', primary: { main: PALE_BRAND } } })}>
          <Switch />
        </ThemeProvider>,
      );
    });
    // The resting track is `action.disabled` washed over the page, which no
    // tenant chooses — so this one was never the defect, and a fix that
    // repainted it would be a redesign wearing a bug fix's clothes.
    expect(thumbFill(rules, 'resting')).toBe('#fff');
  });
});
