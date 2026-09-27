/**
 * `size` SPEAKS THE HOUSE VOCABULARY, NOT ONLY MUI'S OWN WORDS (FUT-2771).
 *
 * Every other sized component in the package accepts `SizeValue`
 * (`'xs' | 'sm' | 'md' | 'lg' | 'xl'`) and translates it to MUI's own
 * `'small' | 'medium' | 'large'` at the MUI boundary via `muiSize()`. `Checkbox`
 * instead forwarded MUI's own words straight through: `size="sm"` type-checked
 * nowhere, and cast past the type it reached MUI as an unknown value and
 * silently fell back — `MuiCheckbox-sizeSm`/`MuiSvgIcon-fontSizeSm` are not
 * real MUI style variants, so the glyph drew at the `SvgIcon` default instead
 * of the small step the caller asked for.
 *
 * This file pins both halves of the fix: `SizeValue` is accepted and reaches
 * MUI as a REAL size (translated, not merely type-widened), and MUI's own
 * deprecated words keep rendering exactly as they did before.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Checkbox } from '../Checkbox';
import type { CheckboxProps } from '../Checkbox.types';

/** House word → the MUI size it must land on, same mapping `muiSize()` gives. */
const SIZE_TO_MUI = {
  xs: 'small',
  sm: 'small',
  md: 'medium',
  lg: 'large',
  xl: 'large',
} as const;

const capitalize = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

describe('CheckboxProps size', () => {
  it('keeps the prop tied to the house SizeValue vocabulary', () => {
    // Before the fix, `CheckboxProps['size']` was MUI's own
    // `'small' | 'medium' | 'large'` only, so `'sm'` — the word every other
    // sized component in this package accepts — did not type-check here.
    // Deleting or narrowing this line must fail `tsc` again.
    const accepted: CheckboxProps['size'] = 'sm';
    expect(accepted).toBe('sm');
  });

  it.each(Object.entries(SIZE_TO_MUI) as Array<[keyof typeof SIZE_TO_MUI, 'small' | 'medium' | 'large']>)(
    'translates size=%s to a REAL MUI size (%s), not a passthrough of the raw word',
    (houseSize, muiWord) => {
      render(<Checkbox dataTestId={`cb-${houseSize}`} size={houseSize} />);
      const root = screen.getByTestId(`cb-${houseSize}`);
      const svg = root.querySelector('svg');
      const capitalized = capitalize(muiWord);

      expect(root.className).toContain(`MuiCheckbox-size${capitalized}`);
      expect(svg).not.toBeNull();
      expect(svg?.getAttribute('class')).toContain(`MuiSvgIcon-fontSize${capitalized}`);
    },
  );

  it.each(['small', 'medium', 'large'] as const)(
    "keeps rendering MUI's own deprecated word %s exactly as before",
    (muiWord) => {
      render(<Checkbox dataTestId={`legacy-${muiWord}`} size={muiWord} />);
      const root = screen.getByTestId(`legacy-${muiWord}`);
      const svg = root.querySelector('svg');
      const capitalized = capitalize(muiWord);

      expect(root.className).toContain(`MuiCheckbox-size${capitalized}`);
      expect(svg?.getAttribute('class')).toContain(`MuiSvgIcon-fontSize${capitalized}`);
    },
  );

  it('leaves size unset alone, so an existing caller keeps MUI’s own default', () => {
    render(<Checkbox dataTestId="cb-unset" />);
    const root = screen.getByTestId('cb-unset');
    expect(root.className).toContain('MuiCheckbox-sizeMedium');
  });
});
