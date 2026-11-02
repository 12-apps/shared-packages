// @vitest-environment jsdom
/**
 * FUT-590, UI review — the owner's activation card form takes the holder's
 * CPF or CNPJ exactly as the checkout's field does: the number keyboard, the
 * phone's link to the letters one (an alphanumeric CNPJ), no link on a
 * computer, a pasted label dropped, and no spell-check on the document.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createActivationStep } from '../activation-step';
import type { ActivationStepCopy } from '../copy';
import { EN_US_ACTIVATION_STEP_COPY } from '../copy-en-US';
import { PT_BR_ACTIVATION_STEP_COPY } from '../copy-pt-BR';
import { TEST_COPY, TestCardSurface, formatAmount, noopValidateTaxId } from './fixtures';

const hooks = vi.hoisted(() => ({ charge: vi.fn(), redirect: vi.fn() }));

vi.mock('../../use-redirect-activation', () => ({
  useRedirectActivation: (...args: unknown[]) => hooks.redirect(...args),
}));
vi.mock('../../use-activation-charge', () => ({
  useActivationCharge: (...args: unknown[]) => hooks.charge(...args),
}));

const TO_LETTERS = 'Seu CNPJ tem letras? Usar teclado com letras';
const TO_NUMBERS = 'Voltar ao teclado de números';

function charge(setCpf = vi.fn()) {
  return {
    card: { number: '', holder: '', expiry: '', cvv: '' },
    setCard: vi.fn(),
    fieldErrors: {},
    setFieldErrors: vi.fn(),
    cpf: '',
    setCpf,
    cpfError: undefined,
    setCpfError: vi.fn(),
    email: 'owner@example.test',
    setEmail: vi.fn(),
    emailError: undefined,
    setEmailError: vi.fn(),
    amountCents: null,
    state: { kind: 'idle' } as const,
    submit: vi.fn(),
    reset: vi.fn(),
  };
}

const WITH_LINK: ActivationStepCopy = { ...TEST_COPY, taxId: { ...TEST_COPY.taxId, lettersKeyboard: TO_LETTERS, numbersKeyboard: TO_NUMBERS } };

function mount(copy: ActivationStepCopy = WITH_LINK): void {
  const Step = createActivationStep({
    verifyChargeUrl: (provider) => `/verify/${provider}`,
    copy,
    formatAmount,
    CardSurface: TestCardSurface,
    validateTaxId: noopValidateTaxId,
  });
  render(
    <Step
      provider="pagbank"
      displayName="PagBank"
      connected
      proven={false}
      blocked={false}
      hidden={false}
      onVerified={vi.fn()}
      onSetupIncomplete={vi.fn()}
      ownerEmail="owner@example.test"
      storeUrl="https://shop.example.test/menu"
      onProviderOrder={vi.fn()}
    />,
  );
}

function input(): HTMLInputElement {
  const field = screen.getByTestId('verify-charge-cpf');
  return (field.querySelector('input') ?? field) as HTMLInputElement;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  hooks.charge.mockReset();
});

describe("the activation form's document field", () => {
  it('opens the number keyboard, and on a phone offers the letters one and back', () => {
    hooks.charge.mockReturnValue(charge());
    mount();
    expect(input().getAttribute('inputmode')).toBe('numeric');
    const link = screen.getByTestId('verify-charge-cpf-keyboard');
    expect(link.textContent).toContain(TO_LETTERS);

    fireEvent.click(link);
    expect(input().getAttribute('inputmode')).toBe('text');
    expect(screen.getByTestId('verify-charge-cpf-keyboard').textContent).toContain(TO_NUMBERS);
  });

  it('offers no link on a computer, whose keyboard already has letters', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('pointer: fine'),
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }));
    hooks.charge.mockReturnValue(charge());
    mount();
    expect(input().getAttribute('inputmode')).toBe('numeric');
    expect(document.body.textContent ?? '').not.toContain(TO_LETTERS);
  });

  it('keeps the document of a labelled paste, and its letters', () => {
    const setCpf = vi.fn();
    hooks.charge.mockReturnValue(charge(setCpf));
    mount();
    fireEvent.change(input(), { target: { value: 'CNPJ: 11.222.333/0001-81' } });
    expect(setCpf).toHaveBeenLastCalledWith('11222333000181');
    fireEvent.change(input(), { target: { value: '12.abc.345/01de-35' } });
    expect(setCpf).toHaveBeenLastCalledWith('12ABC34501DE35');
  });

  it('tells the phone not to spell-check, autocorrect or lower-case it', () => {
    hooks.charge.mockReturnValue(charge());
    mount();
    expect(input().getAttribute('spellcheck')).toBe('false');
    expect(input().getAttribute('autocorrect')).toBe('off');
    expect(input().getAttribute('autocapitalize')).toBe('characters');
  });

  it.each([
    ['pt-BR', PT_BR_ACTIVATION_STEP_COPY, 'CPF ou CNPJ'],
    ['en-US', EN_US_ACTIVATION_STEP_COPY, 'CPF or CNPJ'],
  ])('asks for a CPF or CNPJ in %s, never "digits only" — it takes letters now', (_locale, copy, placeholder) => {
    hooks.charge.mockReturnValue(charge());
    mount({ ...TEST_COPY, taxId: copy.taxId });
    expect(input().getAttribute('placeholder')).toBe(placeholder);
  });
});
