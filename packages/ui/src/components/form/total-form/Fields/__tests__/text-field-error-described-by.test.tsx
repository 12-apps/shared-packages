/**
 * A field's ERROR IS ANNOUNCED, not only its invalid state (FUT-4887).
 *
 * `Fields.TextField` set `aria-invalid` on the `<input>` and drew the message
 * under it, but the two were not linked: the message had no id and the input
 * no `aria-describedby`. A screen reader said "invalid" and never why. Each
 * case asks for the input by the description a screen reader reads.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FormMessage } from '../../../Form';
import { FormContainer } from '../../FormContainer';
import { SubmitButton } from '../../SubmitButton';
import { TextField, type TextFieldProps } from '../TextField';

const REQUIRED = 'Informe o documento.';

function documentForm(props: Partial<TextFieldProps> = {}) {
  return (
    <FormContainer<{ documentId: string }>
      initialValues={{ documentId: '' }}
      schema={{ documentId: [(value) => (String(value ?? '').length > 0 ? undefined : REQUIRED)] }}
      onSubmit={vi.fn()}
    >
      <TextField name="documentId" label="Documento" {...props} />
      <SubmitButton>Enviar</SubmitButton>
    </FormContainer>
  );
}

function renderField(props: Partial<TextFieldProps> = {}) {
  render(documentForm(props));
  return screen.getByTestId('total-form-field-documentId');
}

async function submitAndSeeError(): Promise<HTMLElement> {
  fireEvent.click(screen.getByText('Enviar'));
  const message = await screen.findByTestId('total-form-field-documentId-message');
  expect(message).toHaveTextContent(REQUIRED);
  return message;
}

describe('Fields.TextField: the error describes the input', () => {
  it('points the input at nothing while the field has no error', () => {
    const input = renderField();

    expect(input).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByTestId('total-form-field-documentId-message')).toBeNull();
  });

  it("points the input's aria-describedby at the message's id once the error shows", async () => {
    const input = renderField();

    const message = await submitAndSeeError();

    expect(message.id).not.toBe('');
    expect(input).toHaveAttribute('aria-describedby', message.id);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('textbox', { name: 'Documento', description: REQUIRED })).toBe(input);
  });

  it("keeps the caller's own description and adds the error after it", async () => {
    const input = renderField({ inputProps: { 'aria-describedby': 'documento-dica' } });
    expect(input).toHaveAttribute('aria-describedby', 'documento-dica');

    const message = await submitAndSeeError();

    expect(input).toHaveAttribute('aria-describedby', `documento-dica ${message.id}`);
  });

  it('gives two same-named fields on one page different message ids', async () => {
    render(
      <>
        {documentForm()}
        {documentForm()}
      </>,
    );

    for (const button of screen.getAllByText('Enviar')) fireEvent.click(button);
    const messages = await screen.findAllByTestId('total-form-field-documentId-message');
    const inputs = screen.getAllByTestId('total-form-field-documentId');

    expect(messages).toHaveLength(2);
    expect(new Set(messages.map((message) => message.id)).size).toBe(2);
    expect(inputs.map((input) => input.getAttribute('aria-describedby'))).toEqual(
      messages.map((message) => message.id),
    );
  });

  it('drops the link when the error goes away', async () => {
    const input = renderField();
    await submitAndSeeError();

    fireEvent.change(input, { target: { value: '11222333000181' } });

    await waitFor(() => expect(screen.queryByTestId('total-form-field-documentId-message')).toBeNull());
    expect(input).not.toHaveAttribute('aria-describedby');
  });
});

describe('FormMessage: id', () => {
  it('renders the id it is given, for a control to point at', () => {
    render(
      <FormMessage error id="campo-erro" dataTestId="campo-mensagem">
        Obrigatório
      </FormMessage>,
    );

    expect(screen.getByTestId('campo-mensagem')).toHaveAttribute('id', 'campo-erro');
  });

  it('renders no id when given none', () => {
    render(<FormMessage dataTestId="campo-mensagem">Dica</FormMessage>);

    expect(screen.getByTestId('campo-mensagem')).not.toHaveAttribute('id');
  });
});
