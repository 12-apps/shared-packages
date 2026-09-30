/**
 * THE CEP INPUT POINTS AT ITS LOOKUP STATUS (FUT-2619).
 *
 * `CepField` renders the lookup outcome ("Buscando endereço…", "CEP não
 * encontrado — …") in a `role="status"` live region and names it with
 * `aria-describedby` so a screen reader on the field hears it. The attribute
 * was handed to `Input`, which let every `aria-*` but `aria-label` fall through
 * to the text field's ROOT `<div>`: the region existed, and nothing on the
 * `<input>` pointed at it. `aria-busy` went the same way. In the browser,
 * `Form/CepField/Tests › Exposes Accessible Status` read `null` off the input.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PT_BR_CEP_FIELD_COPY } from '../../../../pt-BR';
import { CepField } from '../CepField';

function renderField() {
  render(
    <CepField copy={PT_BR_CEP_FIELD_COPY} name="postalCode" label="CEP" value="" onChange={() => {}} />,
  );
  return screen.getByTestId('cep-field-postalCode');
}

describe('CepField: the input is described by the lookup status', () => {
  it('puts aria-describedby on the <input>, naming the status region', () => {
    const input = renderField();

    expect(input.tagName).toBe('INPUT');
    expect(input).toHaveAttribute('aria-describedby', 'cep-field-postalCode-status');
    expect(document.getElementById('cep-field-postalCode-status')).toHaveAttribute('role', 'status');
  });

  it('puts aria-busy on the <input>, and leaves neither on the wrapper', () => {
    const input = renderField();

    expect(input).toHaveAttribute('aria-busy', 'false');
    const root = input.closest('.MuiFormControl-root');
    expect(root).not.toBeNull();
    expect(root).not.toHaveAttribute('aria-describedby');
    expect(root).not.toHaveAttribute('aria-busy');
  });
});
