/**
 * A REFUSED SUBMIT TAKES THE PERSON TO THE PROBLEM.
 *
 * `FormContainer` set the errors and returned, so focus stayed on the submit
 * button: on a short phone the first highlighted field sat above the viewport
 * while the alert asked to fix "the highlighted fields", and a keyboard or
 * screen-reader user was taken nowhere. Now the first invalid field in DOM
 * order is focused and scrolled into view, after client validation and after a
 * server refusal handed to `setFieldErrors`. A submit that passes moves nothing.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useFormContext } from '../FormContext';
import { FormContainer, type FormSubmitHelpers } from '../FormContainer';
import { SelectField } from '../Fields/SelectField';
import { TextField } from '../Fields/TextField';
import { ToggleField } from '../Fields/ToggleField';
import { SubmitButton } from '../SubmitButton';

interface Values extends Record<string, string> {
  first: string;
  second: string;
  third: string;
}

const filled = (value: unknown): string | undefined => (String(value ?? '').length > 0 ? undefined : 'Obrigatório');

type OnSubmit = (values: Values, helpers: FormSubmitHelpers) => void | Promise<void>;

function threeFields(options: { initial?: Partial<Values>; onSubmit?: OnSubmit; extra?: React.ReactNode } = {}) {
  render(
    <FormContainer<Values>
      initialValues={{ first: 'ok', second: '', third: '', ...options.initial }}
      // Schema order is NOT DOM order: the field the person meets first wins.
      schema={{ third: [filled], second: [filled] }}
      onSubmit={options.onSubmit ?? vi.fn()}
    >
      <TextField name="first" label="Primeiro" />
      <TextField name="second" label="Segundo" />
      <TextField name="third" label="Terceiro" />
      {options.extra}
      <SubmitButton>Enviar</SubmitButton>
    </FormContainer>,
  );
}

const field = (name: string) => screen.getByTestId(`total-form-field-${name}`);
const submit = () => screen.getByTestId('total-form-submit');

// Nothing has focus before the press (jsdom's click does not move it), so a
// refusal that moves nothing leaves it on the body.
function pressSubmit(): void {
  fireEvent.click(submit());
}

function preferReducedMotion(reduce: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion: reduce'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

const scrollIntoView = vi.fn();

beforeEach(() => {
  scrollIntoView.mockReset();
  // jsdom implements no layout, so it has no `scrollIntoView`.
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
  preferReducedMotion(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('FormContainer: a refused submit focuses the first invalid field', () => {
  it('after client validation, focuses the first invalid field in DOM order and scrolls it into view', async () => {
    threeFields();

    pressSubmit();

    await waitFor(() => expect(field('second')).toHaveFocus());
    expect(field('second')).toHaveAttribute('aria-invalid', 'true');
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(field('second'));
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
  });

  it('scrolls without animation when the person prefers reduced motion', async () => {
    preferReducedMotion(true);
    threeFields();

    pressSubmit();

    await waitFor(() => expect(field('second')).toHaveFocus());
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' });
  });

  it('after a server refusal through setFieldErrors, focuses the field it names', async () => {
    const onSubmit = vi.fn<OnSubmit>(async (_values, { setFieldErrors }) => {
      await Promise.resolve();
      setFieldErrors({ third: 'Já existe.' });
    });
    threeFields({ initial: { second: 'b', third: 'c' }, onSubmit });

    pressSubmit();

    await waitFor(() => expect(field('third')).toHaveFocus());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(field('third'));
  });

  it('moves nothing on a submit that passes', async () => {
    const onSubmit = vi.fn<OnSubmit>();
    threeFields({ initial: { second: 'b', third: 'c' }, onSubmit });

    pressSubmit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(document.body).toHaveFocus());
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('moves nothing when the server answer clears the errors', async () => {
    const onSubmit = vi.fn<OnSubmit>((_values, { setFieldErrors }) => setFieldErrors({}));
    threeFields({ initial: { second: 'b', third: 'c' }, onSubmit });

    pressSubmit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(document.body).toHaveFocus());
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("does not move focus when a field sets errors through the context's setFieldErrors", async () => {
    function LiveCheck() {
      const { setFieldErrors } = useFormContext();
      return (
        <button type="button" onClick={() => setFieldErrors({ second: 'Curto demais' })}>
          Conferir
        </button>
      );
    }
    threeFields({ extra: <LiveCheck /> });
    fireEvent.click(screen.getByText('Conferir'));

    await screen.findByTestId('total-form-field-second-message');
    expect(field('second')).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(document.body).toHaveFocus());
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

describe('FormContainer: an invalid field that cannot take focus is passed by', () => {
  it.each([
    ['display: none', { style: { display: 'none' } }],
    ['the hidden attribute', { hidden: true }],
    ['visibility: hidden', { style: { visibility: 'hidden' as const } }],
  ])('skips one hidden by %s and focuses the next visible invalid field', async (_how, wrapper) => {
    threeFields({
      extra: (
        <div {...wrapper}>
          <input aria-invalid="true" aria-label="Escondido" data-testid="escondido" />
        </div>
      ),
    });
    // DOM order: the three fields, then the hidden control. Put it first.
    const hidden = screen.getByTestId('escondido').parentElement as HTMLElement;
    field('first').closest('form')?.prepend(hidden);

    pressSubmit();

    await waitFor(() => expect(field('second')).toHaveFocus());
    expect(scrollIntoView.mock.contexts[0]).toBe(field('second'));
  });

  it('skips a disabled invalid control', async () => {
    threeFields();
    const disabled = document.createElement('input');
    disabled.setAttribute('aria-invalid', 'true');
    disabled.disabled = true;
    field('first').closest('form')?.prepend(disabled);

    pressSubmit();

    await waitFor(() => expect(field('second')).toHaveFocus());
  });
});

describe('FormContainer: two forms on one page', () => {
  function namedForm(id: string) {
    return (
      <FormContainer<{ nome: string }>
        initialValues={{ nome: '' }}
        schema={{ nome: [filled] }}
        onSubmit={vi.fn()}
        dataTestId={`form-${id}`}
      >
        <TextField name="nome" label={`Nome ${id}`} />
        <SubmitButton>{`Enviar ${id}`}</SubmitButton>
      </FormContainer>
    );
  }

  it("a refused submit in the second form focuses its own field, never the first form's", async () => {
    render(
      <>
        {namedForm('A')}
        {namedForm('B')}
      </>,
    );
    const [nomeA, nomeB] = screen.getAllByTestId('total-form-field-nome');

    fireEvent.click(screen.getByText('Enviar A'));
    await waitFor(() => expect(nomeA).toHaveFocus());

    // A's field is still invalid, and first in DOM order, when B is refused.
    fireEvent.click(screen.getByText('Enviar B'));
    await waitFor(() => expect(nomeB).toHaveFocus());
    expect(nomeA).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('FormContainer: the focus lands on a control that can take it', () => {
  const OPTIONS = [
    { value: 'kg', label: 'Quilo' },
    { value: 'un', label: 'Unidade' },
  ];

  function oneField(control: React.ReactNode) {
    render(
      <FormContainer<{ unit: string }>
        initialValues={{ unit: '' }}
        schema={{ unit: [filled] }}
        onSubmit={vi.fn()}
      >
        {control}
        <SubmitButton>Enviar</SubmitButton>
      </FormContainer>,
    );
  }

  it("SelectField: the combobox, not MUI's hidden native input", async () => {
    oneField(<SelectField name="unit" label="Unidade" options={OPTIONS} />);

    pressSubmit();

    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Unidade' })).toHaveFocus());
  });

  it("ToggleField: a segment of the group, since the group itself takes no focus", async () => {
    oneField(<ToggleField name="unit" label="Unidade" options={OPTIONS} />);

    pressSubmit();

    await waitFor(() => expect(screen.getByTestId('total-form-field-unit-item-kg')).toHaveFocus());
  });
});
