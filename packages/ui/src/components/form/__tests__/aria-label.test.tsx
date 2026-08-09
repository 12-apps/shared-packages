/**
 * `aria-label` has to reach the element that CARRIES THE ROLE (FUT-755).
 *
 * Both of these components wrap a MUI control whose root is a `FormControl`
 * div, and both spread their remaining props onto that root. So an `aria-label`
 * passed by a consumer landed on a div with no role, and the control itself
 * kept no accessible name:
 *
 * - `Select` — `role="combobox"` sits on MUI's display div. With no label,
 *   MUI's own `aria-labelledby` then pointed at that div's OWN id, a
 *   self-reference which resolves to its text. The control announced as its
 *   current VALUE ("Status") instead of its role ("Filtro 1 — campo").
 * - `Input` — the name belongs on the `<input>`, reachable only via
 *   `inputProps`.
 *
 * Both were invisible to a source grep: the labels were right there in the
 * caller. Only the rendered accessibility tree disagreed. These cases assert
 * against that tree, via the accessible-name computation `getByRole`'s `name`
 * option performs — not against the attribute.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Input } from '../Input';
import { Select } from '../Select';

const OPTIONS = [
  { value: 'eq', label: 'igual a' },
  { value: 'gt', label: 'maior que' },
];

describe('Select — accessible name', () => {
  it('names the combobox from aria-label when there is no visible label', () => {
    render(<Select aria-label="Filtro 1 — campo" options={OPTIONS} value="eq" />);

    expect(screen.getByRole('combobox', { name: 'Filtro 1 — campo' })).toBeTruthy();
  });

  it('does not fall back to the selected value as the name', () => {
    render(<Select aria-label="Filtro 1 — condição" options={OPTIONS} value="eq" />);

    // "igual a" is the VALUE. Before the fix it was also the accessible name,
    // which told a screen-reader user what the control held and nothing about
    // what it was.
    expect(screen.queryAllByRole('combobox', { name: 'igual a' })).toEqual([]);
  });

  it('still names a labelled select from its visible label', () => {
    render(<Select label="Eixo X" options={OPTIONS} value="eq" />);

    // Named through a real InputLabel, so `aria-labelledby` is the mechanism
    // here and must survive the aria-label branch being added beside it.
    const combobox = screen.getByRole('combobox');
    expect(combobox.getAttribute('aria-labelledby')).toBeTruthy();
    expect(combobox.getAttribute('aria-label')).toBeNull();
    // The outlined variant draws the text twice: the InputLabel, and the
    // fieldset legend that cuts the notch. Both are legitimate.
    expect(screen.getAllByText('Eixo X').length).toBeGreaterThan(0);
  });
});

describe('Input — accessible name', () => {
  it('names the input from aria-label', () => {
    render(<Input aria-label="Buscar relatórios" value="" onChange={() => undefined} />);

    expect(screen.getByRole('textbox', { name: 'Buscar relatórios' })).toBeTruthy();
  });

  it('puts the name on the input element itself, not on the wrapper', () => {
    render(<Input aria-label="Título do bloco" value="" onChange={() => undefined} />);

    const input = screen.getByRole('textbox', { name: 'Título do bloco' });
    expect(input.tagName).toBe('INPUT');
  });

  it('leaves a placeholder-only input unnamed, so the gap stays visible', () => {
    render(<Input placeholder="Título do bloco" value="" onChange={() => undefined} />);

    // A placeholder is not a label. Asserting this keeps the fix honest: it
    // names what the caller labelled, and does not invent a name from
    // placeholder text.
    expect(screen.queryAllByRole('textbox', { name: 'Título do bloco' })).toEqual([]);
  });
});
