/**
 * `SelectField` and `ToggleField` ANNOUNCE THEIR ERROR, as `TextField` does
 * (FUT-4887 for the text field).
 *
 * The select's combobox said "invalid" and never why: its message had no id
 * and the combobox no `aria-describedby`. The toggle's group said neither, with
 * no `aria-invalid` either. Each case asks for the control by the description a
 * screen reader reads. The select is checked on both of its paths: the menu (up
 * to five options) and the search box (six or more).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { FormContainer } from '../../FormContainer';
import { SubmitButton } from '../../SubmitButton';
import { SelectField } from '../SelectField';
import { ToggleField } from '../ToggleField';

const REQUIRED = 'Escolha uma opção.';
const LABEL = 'Unidade';
const TWO = [
  { value: 'kg', label: 'Quilo' },
  { value: 'un', label: 'Unidade' },
];
const SIX = ['a', 'b', 'c', 'd', 'e', 'f'].map((value) => ({ value, label: `Opção ${value}` }));

interface Case {
  name: string;
  role: 'combobox' | 'group';
  field: (describedBy?: string) => React.ReactElement;
}

const MENU: Case = {
  name: 'SelectField (menu)',
  role: 'combobox',
  field: (describedBy) => <SelectField name="unit" label={LABEL} options={TWO} aria-describedby={describedBy} />,
};
const TOGGLE: Case = {
  name: 'ToggleField',
  role: 'group',
  field: (describedBy) => <ToggleField name="unit" label={LABEL} options={TWO} aria-describedby={describedBy} />,
};

const CASES: Case[] = [
  MENU,
  {
    name: 'SelectField (search box)',
    role: 'combobox',
    field: (describedBy) => <SelectField name="unit" label={LABEL} options={SIX} aria-describedby={describedBy} />,
  },
  TOGGLE,
];

function unitForm(field: React.ReactElement) {
  return (
    <FormContainer<{ unit: string }>
      initialValues={{ unit: '' }}
      schema={{ unit: [(value) => (String(value ?? '').length > 0 ? undefined : REQUIRED)] }}
      onSubmit={vi.fn()}
    >
      {field}
      <SubmitButton>Enviar</SubmitButton>
    </FormContainer>
  );
}

async function submitAndSeeError(): Promise<HTMLElement> {
  fireEvent.click(screen.getByText('Enviar'));
  const message = await screen.findByTestId('total-form-field-unit-message');
  expect(message).toHaveTextContent(REQUIRED);
  return message;
}

describe.each(CASES)('$name: the error describes the control', ({ role, field }) => {
  const control = () => screen.getByRole(role, { name: LABEL });

  it('points the control at nothing, and is not invalid, while the field has no error', async () => {
    render(unitForm(field()));

    expect(control()).not.toHaveAttribute('aria-describedby');
    expect(control()).not.toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => {
      expect(screen.queryByTestId('total-form-field-unit-message')).toBeNull();
    });
  });

  it("marks the control invalid and points its aria-describedby at the message's id", async () => {
    render(unitForm(field()));

    const message = await submitAndSeeError();

    expect(message.id).not.toBe('');
    expect(control()).toHaveAttribute('aria-invalid', 'true');
    expect(control()).toHaveAttribute('aria-describedby', message.id);
    expect(screen.getByRole(role, { name: LABEL, description: REQUIRED })).toBe(control());
  });

  it("keeps the caller's own description and adds the error after it", async () => {
    render(unitForm(field('unidade-dica')));
    expect(control()).toHaveAttribute('aria-describedby', 'unidade-dica');

    const message = await submitAndSeeError();

    expect(control()).toHaveAttribute('aria-describedby', `unidade-dica ${message.id}`);
  });

  it('gives two same-named fields on one page different message ids', async () => {
    render(
      <>
        {unitForm(field())}
        {unitForm(field())}
      </>,
    );

    for (const button of screen.getAllByText('Enviar')) fireEvent.click(button);
    const messages = await screen.findAllByTestId('total-form-field-unit-message');
    const controls = screen.getAllByRole(role, { name: LABEL });

    expect(messages).toHaveLength(2);
    expect(new Set(messages.map((message) => message.id)).size).toBe(2);
    expect(controls.map((element) => element.getAttribute('aria-describedby'))).toEqual(
      messages.map((message) => message.id),
    );
  });
});

describe('the link goes when the error does', () => {
  it('SelectField (menu): choosing an option drops the description', async () => {
    render(unitForm(<SelectField name="unit" label={LABEL} options={TWO} />));
    await submitAndSeeError();

    fireEvent.mouseDown(screen.getByRole('combobox', { name: LABEL }));
    fireEvent.click(await screen.findByRole('option', { name: 'Quilo' }));

    await waitFor(() => expect(screen.queryByTestId('total-form-field-unit-message')).toBeNull());
    expect(screen.getByRole('combobox', { name: LABEL })).not.toHaveAttribute('aria-describedby');
  });

  it('ToggleField: choosing a segment drops the description and the invalid state', async () => {
    render(unitForm(<ToggleField name="unit" label={LABEL} options={TWO} />));
    await submitAndSeeError();

    fireEvent.click(screen.getByTestId('total-form-field-unit-item-kg'));

    await waitFor(() => expect(screen.queryByTestId('total-form-field-unit-message')).toBeNull());
    const group = screen.getByRole('group', { name: LABEL });
    expect(group).not.toHaveAttribute('aria-describedby');
    expect(group).not.toHaveAttribute('aria-invalid');
  });
});
