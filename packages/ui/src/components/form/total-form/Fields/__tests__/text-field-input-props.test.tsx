/**
 * `Fields.TextField` CARRIES `autoComplete` AND `inputProps` TO THE `<input>` (FUT-4140).
 *
 * The total-form field took only `name`, `label`, `type` and `placeholder`, so
 * a form for somebody else's data (a supplier, a category) could not say "do
 * not autofill this": Chrome read the `name` and offered the signed-in owner's
 * own name, phone and e-mail. Every assertion reads the `<input>` itself — a
 * keypad hint or an `autocomplete` on the wrapper `div` is exactly the bug.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FormContainer } from '../../FormContainer';
import { TextField, type TextFieldProps } from '../TextField';

function renderField(props: Partial<TextFieldProps> = {}) {
  render(
    <FormContainer<{ phone: string }> initialValues={{ phone: '' }} onSubmit={vi.fn()}>
      <TextField name="phone" label="Telefone" {...props} />
    </FormContainer>,
  );
  const input = screen.getByTestId('total-form-field-phone');
  const root = input.closest('.MuiFormControl-root') as HTMLElement;
  return { input, root };
}

describe('Fields.TextField: autoComplete', () => {
  it('puts autocomplete on the <input>, not the wrapper', () => {
    const { input, root } = renderField({ autoComplete: 'off' });

    expect(input.tagName).toBe('INPUT');
    expect(input).toHaveAttribute('autocomplete', 'off');
    expect(root).not.toHaveAttribute('autocomplete');
  });

  it('writes no autocomplete at all when none is given, as before', () => {
    const { input } = renderField();

    expect(input).not.toHaveAttribute('autocomplete');
  });

  it('carries new-password for a secret the password manager must not fill', () => {
    const { input } = renderField({ type: 'password', autoComplete: 'new-password' });

    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveAttribute('autocomplete', 'new-password');
  });

  it('lets inputProps.autoComplete win over the top-level one', () => {
    const { input } = renderField({ autoComplete: 'off', inputProps: { autoComplete: 'tel' } });

    expect(input).toHaveAttribute('autocomplete', 'tel');
  });
});

describe('Fields.TextField: inputProps', () => {
  it('puts the keypad and typing hints on the <input>, none on the wrapper', () => {
    const { input, root } = renderField({
      type: 'tel',
      inputProps: {
        inputMode: 'tel',
        autoCapitalize: 'none',
        autoCorrect: 'off',
        spellCheck: false,
        maxLength: 15,
        enterKeyHint: 'next',
      },
    });

    expect(input).toHaveAttribute('type', 'tel');
    expect(input).toHaveAttribute('inputmode', 'tel');
    expect(input).toHaveAttribute('autocapitalize', 'none');
    expect(input).toHaveAttribute('autocorrect', 'off');
    expect(input).toHaveAttribute('spellcheck', 'false');
    expect(input).toHaveAttribute('maxlength', '15');
    expect(input).toHaveAttribute('enterkeyhint', 'next');
    for (const attribute of ['inputmode', 'autocapitalize', 'autocorrect', 'spellcheck', 'maxlength']) {
      expect(root).not.toHaveAttribute(attribute);
    }
  });

  it('keeps the field-owned id, name, type, value and test id when a caller tries to replace them', () => {
    // The type keeps these out; plain JS (or a cast) does not, and a renamed
    // test id would silently break every spec that finds the field by it.
    const hostile = { 'data-testid': 'renamed', id: 'other', name: 'other', type: 'number', value: 'x' } as TextFieldProps['inputProps'];
    const { input } = renderField({ inputProps: hostile });

    expect(input).toHaveAttribute('data-testid', 'total-form-field-phone');
    expect(input).toHaveAttribute('id', 'phone');
    expect(input).toHaveAttribute('name', 'phone');
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveValue('');
  });

  it('still writes the typed value into the form, with inputProps given', () => {
    const { input } = renderField({ inputProps: { inputMode: 'tel' } });

    fireEvent.change(input, { target: { value: '11999990000' } });

    expect(input).toHaveValue('11999990000');
  });

  it('keeps the label pointing at the input', () => {
    renderField({ autoComplete: 'off', inputProps: { inputMode: 'tel' } });

    expect(screen.getByLabelText('Telefone')).toBe(screen.getByTestId('total-form-field-phone'));
  });
});
