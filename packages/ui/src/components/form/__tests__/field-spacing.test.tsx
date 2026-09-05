/**
 * A LABEL SITS 4px ABOVE ITS CONTROL, AND ONE THING DECIDES THAT.
 *
 * `FormField` used to say it twice. `StyledFormField` is a flex column and
 * carried `gap: theme.spacing(1)`; `StyledFormLabel` carries
 * `marginBottom: theme.spacing(0.5)`. In a column those ADD, so the row the
 * component draws was 8 + 4 = 12px — three times what every OTHER user of this
 * package's `FormLabel` draws. Each of them (`CepField`, `CategorySelect`,
 * `CreatableSelect`, the three `total-form` fields, five of
 * `@12-apps/discounts`' builders and the host's own `currency-field`) puts a
 * bare `FormLabel` straight inside a `FormControl`, which is a plain block box
 * with no gap of its own, so the label's margin is the whole of their spacing.
 *
 * "Every labelled field in the package" would be too strong, and this file is
 * the wrong place to be loose about it: `Textarea` labels its own control
 * through MUI's `InputLabel` at `theme.spacing(1)`, and is the package's one
 * remaining disagreement about this number. It is named here rather than
 * swept under "everywhere else" — but it composes nothing out of `FormLabel`,
 * so it is not evidence about which of `FormField`'s two spacings to drop.
 *
 * That is not a cosmetic difference at the bottom of a form. Measured in
 * Chromium at 320x568 — the smallest rung a consuming app supports — the
 * six-field delivery address form it was adopted for pushed its submit button
 * from 561px to 609px: 41px below the fold, on the primary action of a
 * checkout.
 *
 * ## What these assert, and why not the distance itself
 *
 * jsdom does no layout, so nothing here can measure the rendered distance —
 * `Form.test.stories.tsx` does that in a real browser. What jsdom can be trusted
 * with is what each element DECLARES, so these read the declarations and add
 * them up. The sum is the point: a suite that pinned `gap` alone would go green
 * on a fix that moved the double count into the label's margin instead.
 *
 * `gap` is read out of the emitted rule rather than through `getComputedStyle`
 * because jsdom's CSSOM has no `gap` longhands — it answers `""` for `row-gap`
 * whether or not one was declared, which is an assertion that cannot fail. The
 * emitted-CSS approach is the one `field-contrast.test.tsx` takes next door, for
 * a related reason.
 */
import { styled } from '@mui/material/styles/index.js';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FormControl, FormField, FormLabel } from '../Form';

/** A column whose gap is the same 8px, said in the other common unit. */
const RemGapped = styled('div')({ display: 'flex', flexDirection: 'column', rowGap: '0.5rem' });

/** A column whose gap is a length `toPx` has no business guessing at. */
const OddlyGapped = styled('div')({ display: 'flex', flexDirection: 'column', rowGap: '2ch' });

/** Every rule emotion has put in the document, as one string. */
function emittedCss(): string {
  return Array.from(document.querySelectorAll('style'))
    .map((tag) => tag.textContent ?? '')
    .join('\n');
}

/** The declarations of an element's OWN emotion rules, concatenated. */
function ownDeclarations(element: HTMLElement): string {
  const css = emittedCss();
  return element.className
    .split(/\s+/u)
    .filter(Boolean)
    .map((cls) => new RegExp(`\\.${cls}\\s*\\{([^}]*)\\}`, 'u').exec(css)?.[1] ?? '')
    .join(';');
}

/**
 * A declared CSS length in pixels, resolved against `element` where the unit is
 * relative. `normal` — what an unset `gap` computes to — is zero.
 *
 * A length this cannot convert THROWS. That is the whole point of the function:
 * a matcher that quietly returned 0 for a unit it did not recognise would
 * report the exact regression this suite exists to catch as "nothing declared".
 */
function toPx(value: string, element: HTMLElement): number {
  if (value === 'normal') return 0;
  const parsed = /^(-?[\d.]+)(px|rem|em)?$/u.exec(value);
  const magnitude = parsed ? Number(parsed[1]) : Number.NaN;
  if (Number.isNaN(magnitude)) {
    throw new Error(`Cannot measure the declared gap "${value}" — teach toPx() its unit.`);
  }
  if (magnitude === 0) return 0;
  const basis = parsed?.[2] === 'rem' ? document.documentElement : element;
  const perUnit =
    parsed?.[2] === undefined || parsed[2] === 'px'
      ? 1
      : Number.parseFloat(window.getComputedStyle(basis).fontSize) || 16;
  return magnitude * perUnit;
}

/**
 * The vertical space an element puts between its own stacked children.
 *
 * `gap` and `row-gap` both land on the row axis of a flex column; `column-gap`
 * deliberately does not, which is what lets a horizontal variant keep one.
 *
 * The UNIT is not assumed, and that is load-bearing rather than tidy. Eight
 * pixels re-added as `rowGap: '0.5rem'` is the same eight pixels as
 * `theme.spacing(1)`, and an earlier matcher that only read `px` scored it as
 * ZERO — the regression this file exists for, passing silently. `theme.spacing()`
 * happens to emit px today, which is exactly why nothing would have noticed.
 */
function rowGapPx(element: HTMLElement): number {
  const declared = /(?:^|;)\s*(?:grid-)?(?:row-)?gap\s*:\s*([^;]+)/u.exec(
    ownDeclarations(element),
  );
  const value = declared?.[1];
  if (value === undefined) return 0;
  // `gap: <row> <column>` — the first length is the row axis, which is ours.
  return toPx(value.trim().split(/\s+/u)[0] ?? '', element);
}

/** The space an element pushes below itself. */
function marginBottomPx(element: HTMLElement): number {
  return Number.parseFloat(window.getComputedStyle(element).marginBottom) || 0;
}

/** Everything that ends up between a label's baseline box and the control under it. */
function labelToControlPx(wrapper: HTMLElement, label: HTMLElement): number {
  return rowGapPx(wrapper) + marginBottomPx(label);
}

describe('the space a field puts between its label and its control', () => {
  it('is the label\'s own 4px, and FormField adds nothing to it', () => {
    render(
      <FormField name="street" label="Street address" dataTestId="street-field">
        <input id="street" />
      </FormField>,
    );

    const field = screen.getByTestId('street-field');
    const label = screen.getByTestId('street-field-label');

    // 12 here is the regression: 8px of wrapper gap on top of the label's 4px.
    expect(labelToControlPx(field, label)).toBe(4);
  });

  it('is the same 4px however the field is composed', () => {
    // The shape every other labelled field in this package uses: a bare
    // `FormLabel` inside a `FormControl`, with no wrapper gap anywhere.
    const { getByTestId } = render(
      <FormControl dataTestId="standalone">
        <FormLabel htmlFor="postcode" dataTestId="standalone-label">
          Postcode
        </FormLabel>
        <input id="postcode" />
      </FormControl>,
    );
    const standalone = labelToControlPx(
      getByTestId('standalone'),
      getByTestId('standalone-label'),
    );

    render(
      <FormField name="neighbourhood" label="Neighbourhood" dataTestId="neighbourhood-field">
        <input id="neighbourhood" />
      </FormField>,
    );
    const composed = labelToControlPx(
      screen.getByTestId('neighbourhood-field'),
      screen.getByTestId('neighbourhood-field-label'),
    );

    // The rule, rather than the number: two ways of drawing one row must not
    // disagree about how far apart a label and its control are.
    expect(composed).toBe(standalone);
  });
});

describe('the measurement the assertions above rest on', () => {
  // `theme.spacing()` emits px, so a matcher that only understood px passed
  // every test here while scoring a rem-stated gap as zero. That is a false
  // green on the one shape this file exists to catch, and jsdom is the only
  // place it CAN be caught: `Form.test.stories.tsx` measures the real distance,
  // but nothing in CI runs `test-storybook` for this package.
  it('reads a row gap whatever unit it was declared in', () => {
    render(
      <RemGapped data-testid="rem-gapped">
        <span>label</span>
        <span>control</span>
      </RemGapped>,
    );

    expect(rowGapPx(screen.getByTestId('rem-gapped'))).toBe(8);
  });

  it('refuses to score a gap it cannot convert as nothing', () => {
    render(
      <OddlyGapped data-testid="oddly-gapped">
        <span>label</span>
        <span>control</span>
      </OddlyGapped>,
    );

    expect(() => rowGapPx(screen.getByTestId('oddly-gapped'))).toThrow(/teach toPx/u);
  });
});
