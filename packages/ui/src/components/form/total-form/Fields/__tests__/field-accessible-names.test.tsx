/**
 * The QUESTION names the control (FUT-4157).
 *
 * `SelectField` and `ToggleField` render their label as a `<label htmlFor>`,
 * but neither control is a labelable element with that id: MUI's select puts
 * `role="combobox"` on a div, and a toggle group is a `role="group"` div. A
 * screen reader read "Porcentagem" — the current answer — with no "Tipo de
 * promoção". These cases ask for each control by its role AND the label.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FormContainer } from '../../FormContainer';
import { SelectField } from '../SelectField';
import { ToggleField } from '../ToggleField';

const OPTIONS = [
  { value: 'PERCENTAGE', label: 'Porcentagem' },
  { value: 'COMBO', label: 'Combo' },
];

function inForm(children: React.ReactNode) {
  render(
    <FormContainer<{ kind: string }> initialValues={{ kind: 'PERCENTAGE' }} onSubmit={vi.fn()}>
      {children}
    </FormContainer>,
  );
}

describe('total-form fields are named by their label', () => {
  it('SelectField: the combobox is named by the question', () => {
    inForm(<SelectField name="kind" label="Tipo de promoção" options={OPTIONS} />);
    expect(screen.getByRole('combobox', { name: 'Tipo de promoção' })).toBeInTheDocument();
  });

  it('ToggleField: the group is named by the question', () => {
    inForm(<ToggleField name="kind" label="Tipo de promoção" options={OPTIONS} />);
    expect(screen.getByRole('group', { name: 'Tipo de promoção' })).toBeInTheDocument();
  });

  it('with no label, neither invents a name', () => {
    inForm(<ToggleField name="kind" options={OPTIONS} />);
    expect(screen.getByRole('group')).not.toHaveAttribute('aria-label');
  });
});
