/**
 * CEPFIELD: A CALLER-CHOSEN `autocomplete`, AND THE KEYPAD ON THE `<input>`.
 *
 * FUT-4140: the field hard-coded `autocomplete="postal-code"`, so a supplier
 * form had the browser offer the signed-in OWNER's CEP — and the lookup then
 * filled the owner's street. The default stays `postal-code`; a form for
 * somebody else's address passes `off`.
 *
 * FUT-1440's CepField row: `inputMode="numeric"` was a top-level prop `Input`
 * does not recognise, so it landed on the wrapper `div` and the phone opened
 * the letter keyboard for eight digits. Every assertion reads the `<input>`.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PT_BR_CEP_FIELD_COPY } from '../../../../pt-BR';
import { FormContainer, Fields } from '../../total-form';
import { CepField } from '../CepField';

const rootOf = (input: HTMLElement) => input.closest('.MuiFormControl-root') as HTMLElement;

function renderPlain(autoComplete?: string) {
  render(
    <CepField
      copy={PT_BR_CEP_FIELD_COPY}
      value=""
      onChange={() => {}}
      {...(autoComplete === undefined ? {} : { autoComplete })}
    />,
  );
  return screen.getByTestId('cep-field-postalCode');
}

function renderTotalForm(autoComplete?: string) {
  render(
    <FormContainer<{ cep: string }> initialValues={{ cep: '' }} onSubmit={vi.fn()}>
      <Fields.CepField copy={PT_BR_CEP_FIELD_COPY} name="cep" {...(autoComplete === undefined ? {} : { autoComplete })} />
    </FormContainer>,
  );
  return screen.getByTestId('total-form-field-cep');
}

describe('CepField: autoComplete', () => {
  it('defaults to postal-code on the <input>', () => {
    const input = renderPlain();

    expect(input.tagName).toBe('INPUT');
    expect(input).toHaveAttribute('autocomplete', 'postal-code');
  });

  it('takes off for a form holding somebody else\'s address', () => {
    const input = renderPlain('off');

    expect(input).toHaveAttribute('autocomplete', 'off');
    expect(rootOf(input)).not.toHaveAttribute('autocomplete');
  });

  it('is carried through the total-form wrapper, default and override alike', () => {
    expect(renderTotalForm()).toHaveAttribute('autocomplete', 'postal-code');
  });

  it('carries off through the total-form wrapper', () => {
    expect(renderTotalForm('off')).toHaveAttribute('autocomplete', 'off');
  });
});

describe('CepField: the numeric keypad', () => {
  it('puts inputmode=numeric on the <input> and not on the wrapper', () => {
    const input = renderPlain();

    expect(input).toHaveAttribute('inputmode', 'numeric');
    expect(rootOf(input)).not.toHaveAttribute('inputmode');
  });

  it('keeps it on the <input> through the total-form wrapper, with autocomplete off', () => {
    const input = renderTotalForm('off');

    expect(input).toHaveAttribute('inputmode', 'numeric');
    expect(rootOf(input)).not.toHaveAttribute('inputmode');
    // Moving the keypad into inputProps must not cost the field its test id or
    // the status it is described by.
    expect(input).toHaveAttribute('data-testid', 'total-form-field-cep');
    expect(input).toHaveAttribute('aria-describedby', 'total-form-field-cep-status');
  });
});
