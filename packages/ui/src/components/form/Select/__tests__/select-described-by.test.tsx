/**
 * A caller's `aria-describedby` JOINS the helper text's, on both paths.
 *
 * The menu wrote the helper text's id and then let `{...props}` replace it, so
 * a caller's id dropped the helper; the search box (six options or more) never
 * forwarded a caller's id at all. `total-form`'s `SelectField` points the
 * combobox at its error message through this prop.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Select } from '../Select';

const TWO = [
  { value: 'a', label: 'A' },
  { value: 'b', label: 'B' },
];
const SIX = ['a', 'b', 'c', 'd', 'e', 'f'].map((value) => ({ value, label: value.toUpperCase() }));

describe.each([
  ['menu', TWO],
  ['search box', SIX],
])('Select (%s): aria-describedby', (_path, options) => {
  const combobox = () => screen.getByRole('combobox', { name: 'Campo' });

  it("puts the caller's ids on the combobox", () => {
    render(<Select aria-label="Campo" options={options} value="" aria-describedby="erro" />);

    expect(combobox()).toHaveAttribute('aria-describedby', 'erro');
  });

  it("keeps the helper text first and adds the caller's ids after it", () => {
    render(<Select aria-label="Campo" options={options} value="" helperText="Ajuda" aria-describedby="erro" />);

    expect(combobox()).toHaveAccessibleDescription('Ajuda');
    expect(combobox().getAttribute('aria-describedby')).toMatch(/^\S+ erro$/);
  });

  it('describes the combobox by the helper text alone when the caller gives no ids', () => {
    render(<Select aria-label="Campo" options={options} value="" helperText="Ajuda" />);

    expect(combobox()).toHaveAccessibleDescription('Ajuda');
  });
});
