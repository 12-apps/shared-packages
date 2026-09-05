/**
 * A LABEL SITS 4px ABOVE ITS CONTROL, AND ONE THING DECIDES THAT.
 *
 * `FormField` used to say it twice. `StyledFormField` is a flex column and
 * carried `gap: theme.spacing(1)`; `StyledFormLabel` carries
 * `marginBottom: theme.spacing(0.5)`. In a column those ADD, so the row the
 * component draws was 8 + 4 = 12px — three times the 4px every other field in
 * this package draws, because the rest of them (`CepField`, `CategorySelect`,
 * `CreatableSelect`, the three `total-form` fields, and five of
 * `@12-apps/discounts`' builders) put a bare `FormLabel` straight inside a
 * `FormControl`, which is a plain block box with no gap of its own.
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
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FormControl, FormField, FormLabel } from '../Form';

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
 * The vertical space an element puts between its own stacked children.
 *
 * `gap` and `row-gap` both land on the row axis of a flex column; `column-gap`
 * deliberately does not, which is what lets the horizontal variant keep one.
 */
function rowGapPx(element: HTMLElement): number {
  const declared = /(?:^|;)\s*(?:row-)?gap\s*:\s*([\d.]+)px/u.exec(ownDeclarations(element));
  return declared ? Number(declared[1]) : 0;
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
