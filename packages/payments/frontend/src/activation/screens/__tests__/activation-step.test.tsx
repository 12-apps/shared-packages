// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createActivationStep } from '../activation-step';
import type { ActivationStepProps } from '../activation-step';

import { TEST_COPY, TestCardSurface, formatAmount, noopValidateTaxId } from './fixtures';

/**
 * The router between the two activation flows.
 *
 * Every branch here was learned from a payment that went wrong, and none of
 * them is host knowledge: a card form for a provider with no in-browser card
 * path is a dead end blaming the store for a key that was never going to
 * exist, and a pay button shown to an owner who has already paid is how one of
 * them paid four times.
 */

const hooks = vi.hoisted(() => ({
  redirect: vi.fn(),
  charge: vi.fn(),
}));

vi.mock('../../use-redirect-activation', () => ({
  useRedirectActivation: (...args: unknown[]) => hooks.redirect(...args),
}));
vi.mock('../../use-activation-charge', () => ({
  useActivationCharge: (...args: unknown[]) => hooks.charge(...args),
}));

const IDLE_REDIRECT = {
  state: { kind: 'idle' } as const,
  lastCheckedAt: 0,
  start: vi.fn(),
  checkNow: vi.fn(),
  reset: vi.fn(),
};

const IDLE_CHARGE = {
  card: { number: '', holder: '', expiry: '', cvv: '' },
  setCard: vi.fn(),
  fieldErrors: {},
  setFieldErrors: vi.fn(),
  cpf: '',
  setCpf: vi.fn(),
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

function mountStep(overrides: Partial<ActivationStepProps> = {}) {
  const Step = createActivationStep({
    verifyChargeUrl: (provider) => `/verify/${provider}`,
    copy: TEST_COPY,
    formatAmount,
    CardSurface: TestCardSurface,
    validateTaxId: noopValidateTaxId,
  });
  const props: ActivationStepProps = {
    provider: 'pagbank',
    displayName: 'PagBank',
    connected: true,
    proven: false,
    blocked: false,
    hidden: false,
    onVerified: vi.fn(),
    onSetupIncomplete: vi.fn(),
    ownerEmail: 'owner@example.test',
    storeUrl: 'https://shop.example.test/menu',
    onProviderOrder: vi.fn(),
    ...overrides,
  };
  return { ...render(<Step {...props} />), props };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  hooks.redirect.mockReset();
  hooks.charge.mockReset();
});

describe('the activation step router', () => {
  it('renders nothing until the account is connected', () => {
    hooks.charge.mockReturnValue(IDLE_CHARGE);
    const { container } = mountStep({ connected: false });
    expect(container.firstChild).toBeNull();
  });

  it('renders the proof, not the pay button, once a charge has landed', async () => {
    const onProviderOrder = vi.fn();
    mountStep({ proven: true, onProviderOrder });

    expect(screen.getByTestId('verify-charge-proven')).not.toBeNull();
    await waitFor(() => expect(screen.queryByTestId('verify-charge-form')).toBeNull());
    await waitFor(() => expect(screen.queryByTestId('verify-charge-start-redirect')).toBeNull());

    fireEvent.click(screen.getByTestId('verify-charge-provider-order'));
    expect(onProviderOrder).toHaveBeenCalledTimes(1);
  });

  it('opens the published store from the proven state', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    mountStep({ proven: true });
    fireEvent.click(screen.getByTestId('verify-charge-open-store'));
    expect(open).toHaveBeenCalledWith('https://shop.example.test/menu', '_blank', 'noopener');
    open.mockRestore();
  });

  it('sends a provider with no in-browser card path to the redirect flow', async () => {
    hooks.redirect.mockReturnValue(IDLE_REDIRECT);
    mountStep({ provider: 'infinitepay', displayName: 'InfinitePay' });

    expect(screen.getByTestId('verify-charge-redirect')).not.toBeNull();
    // The dead end this branch exists to prevent: a card form for a provider
    // whose public key was never going to exist.
    await waitFor(() => expect(screen.queryByTestId('verify-charge-form')).toBeNull());
    expect(hooks.charge).not.toHaveBeenCalled();
  });

  it('sends a tokenizing provider to the card flow', () => {
    hooks.charge.mockReturnValue(IDLE_CHARGE);
    mountStep({ provider: 'pagbank' });

    expect(screen.getByTestId('verify-charge')).not.toBeNull();
    expect(screen.getByTestId('verify-charge-form')).not.toBeNull();
    expect(hooks.redirect).not.toHaveBeenCalled();
  });

  it('asks for the CPF in the name of the provider being activated', () => {
    // The threading was proven only by `tsc` — a regression passing the wrong
    // but correctly-typed string (`provider`, the machine key; the host's own
    // brand) compiles and passes every other case. This renders it. The bug
    // (FUT-675) was a hardcoded name, so the assertion is that a NON-default
    // provider's name reaches the field.
    hooks.charge.mockReturnValue(IDLE_CHARGE);
    mountStep({ provider: 'stone', displayName: 'Stone' });

    expect(screen.getByText('Stone requires the card holder tax id')).not.toBeNull();
  });

  it('judges the holder document on blur, and only once something was typed (FUT-4048)', () => {
    // The blur used to call the validator and drop its answer, so a wrong CNPJ
    // was only reported on submit.
    const setCpfError = vi.fn();
    const Step = createActivationStep({
      verifyChargeUrl: (provider) => `/verify/${provider}`,
      copy: TEST_COPY,
      formatAmount,
      CardSurface: TestCardSurface,
      validateTaxId: (value) => (value === '11222333000182' ? 'Informe um CPF ou CNPJ válido.' : undefined),
    });
    const props = {
      provider: 'pagbank',
      displayName: 'PagBank',
      connected: true,
      proven: false,
      blocked: false,
      hidden: false,
      onVerified: vi.fn(),
      onSetupIncomplete: vi.fn(),
      ownerEmail: 'owner@example.test',
      storeUrl: 'https://shop.example.test/menu',
      onProviderOrder: vi.fn(),
    } satisfies ActivationStepProps;

    hooks.charge.mockReturnValue({ ...IDLE_CHARGE, setCpfError });
    const { rerender } = render(<Step {...props} />);
    fireEvent.blur(screen.getByTestId('verify-charge-cpf').querySelector('input') ?? screen.getByTestId('verify-charge-cpf'));
    expect(setCpfError).not.toHaveBeenCalled();

    hooks.charge.mockReturnValue({ ...IDLE_CHARGE, cpf: '11222333000182', setCpfError });
    rerender(<Step {...props} />);
    fireEvent.blur(screen.getByTestId('verify-charge-cpf').querySelector('input') ?? screen.getByTestId('verify-charge-cpf'));
    expect(setCpfError).toHaveBeenCalledWith('Informe um CPF ou CNPJ válido.');
  });

  it('hands each flow the host route for the provider that is open', () => {
    hooks.redirect.mockReturnValue(IDLE_REDIRECT);
    mountStep({ provider: 'infinitepay' });
    expect(hooks.redirect).toHaveBeenCalledWith(
      expect.objectContaining({ verifyChargeUrl: '/verify/infinitepay' }),
    );
  });
});

describe('the walkthrough being on an earlier step', () => {
  it('hides an idle redirect panel, which has nothing to add', () => {
    hooks.redirect.mockReturnValue(IDLE_REDIRECT);
    const { container } = mountStep({ provider: 'infinitepay', hidden: true });
    expect(container.firstChild).toBeNull();
  });

  /**
   * The regression this branch is written around: a refused CREATION is the
   * evidence that withdraws the owner's step-2 confirmation, so the guide goes
   * back a step in the same render that produced the explanation. Unmounting on
   * `hidden` took the explanation with it, and the owner landed on a step they
   * thought was finished with nothing on screen saying why.
   */
  it('keeps a refused creation on screen even though the guide moved back', async () => {
    hooks.redirect.mockReturnValue({
      ...IDLE_REDIRECT,
      state: { kind: 'failed', reason: 'switch is off', atCreation: true },
    });
    mountStep({ provider: 'infinitepay', displayName: 'InfinitePay', hidden: true });

    expect(screen.getByTestId('verify-charge-setup-incomplete')).not.toBeNull();
    expect(screen.getByText('InfinitePay refused to create the charge')).not.toBeNull();
    // The intro is what `hidden` suppresses — not the explanation.
    await waitFor(() => expect(screen.queryByText('Step 3 · Turn on sales')).toBeNull());
  });

  it('withholds only the pay button while an earlier step is unconfirmed', async () => {
    hooks.redirect.mockReturnValue(IDLE_REDIRECT);
    mountStep({ provider: 'infinitepay', blocked: true });

    expect(screen.getByTestId('verify-charge-blocked')).not.toBeNull();
    await waitFor(() => expect(screen.queryByTestId('verify-charge-start-redirect')).toBeNull());
  });
});

describe('the three ways a link never got minted', () => {
  const creationFailures = () => [
    {
      what: 'the provider refused it — a switch, which is a step not an error',
      state: { kind: 'failed' as const, reason: 'off', atCreation: true },
      testId: 'verify-charge-setup-incomplete',
    },
    {
      what: 'the provider was never reached, so it refused nothing',
      state: { kind: 'failed' as const, reason: 'timeout', atCreation: true, transport: true },
      testId: 'verify-charge-unreachable',
    },
    {
      what: 'the payment itself was refused, on a connection that works',
      state: { kind: 'failed' as const, reason: 'declined' },
      testId: 'verify-charge-failed',
    },
  ];

  for (const { what, state, testId } of creationFailures()) {
    it(`gets its own screen: ${what}`, async () => {
      hooks.redirect.mockReturnValue({ ...IDLE_REDIRECT, state });
      mountStep({ provider: 'infinitepay', displayName: 'InfinitePay' });
      expect(screen.getByTestId(testId)).not.toBeNull();
      // The other two must be absent: one panel serving all three could only
      // ever give the first one's advice.
      for (const other of creationFailures().filter((entry) => entry.testId !== testId)) {
        await waitFor(() => expect(screen.queryByTestId(other.testId)).toBeNull());
      }
    });
  }
});

describe('an amount nobody has priced yet', () => {
  /**
   * Not always a cent: at least one provider refuses a one-cent total outright.
   * A screen that guessed would promise one figure and charge another, which is
   * the lie the whole flow exists to remove.
   */
  it('says so rather than guessing a cent', () => {
    hooks.redirect.mockReturnValue(IDLE_REDIRECT);
    mountStep({ provider: 'infinitepay' });
    expect(screen.getByTestId('verify-charge-start-redirect').textContent).toBe(
      'Pay a small amount and activate',
    );
  });

  it('leaves the card flow button without an amount instead of inventing one', () => {
    hooks.charge.mockReturnValue(IDLE_CHARGE);
    mountStep({ provider: 'pagbank' });
    expect(screen.getByTestId('verify-charge-submit').textContent).toBe('Charge and activate');
  });

  it('names the amount the endpoint answered', () => {
    hooks.charge.mockReturnValue({ ...IDLE_CHARGE, amountCents: 101 });
    mountStep({ provider: 'pagbank' });
    expect(screen.getByTestId('verify-charge-submit').textContent).toBe(
      'Charge 101 cents and activate',
    );
  });
});

describe('the copy port', () => {
  /**
   * The screens THROW outside a copy provider rather than falling back. A
   * fallback could only be the origin host's Portuguese, handed silently to the
   * next adopter's store owner.
   */
  it('cannot be skipped', async () => {
    const { ProvenState } = await import('../states');
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<ProvenState storeUrl="/x" onProviderOrder={vi.fn()} />)).toThrow(
      /ActivationCopyProvider/,
    );
    error.mockRestore();
  });
});

/** The link endpoint answers that this provider requires the payer e-mail. */
function requireEmailOnTheLink(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ amountCents: 100, payerEmailRequired: true }) })),
  );
}

/** The `<input>` behind a field's test id, wherever the slot binding puts it. */
function inputOf(testId: string): HTMLInputElement {
  const host = screen.getByTestId(testId);
  return (host.querySelector('input') ?? host) as HTMLInputElement;
}

describe('the payer e-mail (FUT-4050)', () => {
  it('sits in the card form with the hook’s e-mail and the provider named in its hint', () => {
    hooks.charge.mockReturnValue({ ...IDLE_CHARGE, payerEmailRequired: true, email: 'pagador@example.test' });
    mountStep({ provider: 'pagbank', displayName: 'PagBank' });
    expect(inputOf('verify-charge-email').value).toBe('pagador@example.test');
    expect(screen.getByText('Not your PagBank account e-mail')).not.toBeNull();
  });

  it('hands the card hook a validator built from the host’s words', () => {
    hooks.charge.mockReturnValue(IDLE_CHARGE);
    mountStep({ provider: 'pagbank' });
    const { validateEmail } = hooks.charge.mock.calls[0]?.[0] as {
      validateEmail: (value: string) => string | undefined;
    };
    expect(validateEmail('')).toBe('E-mail required');
    expect(validateEmail('sem-arroba')).toBe('E-mail invalid');
    expect(validateEmail(' ok@example.test ')).toBeUndefined();
  });

  it('a refused payer e-mail gets its own panel, and its button goes back to the field', async () => {
    const reset = vi.fn();
    const setEmailError = vi.fn();
    hooks.charge.mockReturnValue({
      ...IDLE_CHARGE,
      reset,
      setEmailError,
      state: { kind: 'failed', reason: 'buyer email', providerMessage: 'raw', payerEmailRefused: true },
    });
    mountStep({ provider: 'pagbank', displayName: 'PagBank' });

    expect(screen.getByText('PagBank refused the payer e-mail')).not.toBeNull();
    // Not the generic refusal, whose "try again" would send the same e-mail.
    await waitFor(() => expect(screen.queryByTestId('verify-charge-failed')).toBeNull());

    fireEvent.click(screen.getByTestId('verify-charge-change-email'));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(setEmailError).toHaveBeenLastCalledWith('PagBank refuses its own account e-mail');
  });

  it('is not asked in the card form where the provider does not require it (FUT-4200)', async () => {
    hooks.charge.mockReturnValue({ ...IDLE_CHARGE, payerEmailRequired: false });
    mountStep({ provider: 'stone', displayName: 'Stone' });
    expect(screen.getByTestId('verify-charge-form')).not.toBeNull();
    await waitFor(() => expect(screen.queryByTestId('verify-charge-email')).toBeNull());
  });

  it('the link flow asks for it where the provider requires it, and mints the link for it', async () => {
    requireEmailOnTheLink();
    const start = vi.fn();
    hooks.redirect.mockReturnValue({ ...IDLE_REDIRECT, start });
    mountStep({ provider: 'infinitepay', displayName: 'InfinitePay' });

    await waitFor(() => expect(inputOf('verify-charge-email').value).toBe('owner@example.test'));
    fireEvent.change(inputOf('verify-charge-email'), { target: { value: 'outro@example.test' } });
    fireEvent.click(screen.getByTestId('verify-charge-start-redirect'));
    expect(start).toHaveBeenCalledWith({ email: 'outro@example.test' });
  });

  it('the link flow opens with the e-mail the endpoint suggests', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ amountCents: 100, payerEmail: 'pagamento@example.test', payerEmailRequired: true }),
      })),
    );
    hooks.redirect.mockReturnValue(IDLE_REDIRECT);
    mountStep({ provider: 'infinitepay', displayName: 'InfinitePay' });
    await waitFor(() => expect(inputOf('verify-charge-email').value).toBe('pagamento@example.test'));
  });

  it('the link flow mints nothing for an empty e-mail, and says why on the field', async () => {
    requireEmailOnTheLink();
    const start = vi.fn();
    hooks.redirect.mockReturnValue({ ...IDLE_REDIRECT, start });
    mountStep({ provider: 'infinitepay', displayName: 'InfinitePay' });
    await waitFor(() => expect(inputOf('verify-charge-email')).not.toBeNull());

    fireEvent.change(inputOf('verify-charge-email'), { target: { value: '' } });
    fireEvent.click(screen.getByTestId('verify-charge-start-redirect'));
    expect(start).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText('E-mail required')).not.toBeNull());
  });
});

describe('the link flow where the e-mail is not required (FUT-4200)', () => {
  it('shows no field and mints the link with no typed e-mail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ amountCents: 100 }) })));
    const start = vi.fn();
    hooks.redirect.mockReturnValue({ ...IDLE_REDIRECT, start });
    mountStep({ provider: 'infinitepay', displayName: 'InfinitePay' });

    await waitFor(() => expect(screen.getByTestId('verify-charge-start-redirect').textContent).toContain('1'));
    await waitFor(() => expect(screen.queryByTestId('verify-charge-email')).toBeNull());
    fireEvent.click(screen.getByTestId('verify-charge-start-redirect'));
    expect(start).toHaveBeenCalledWith();
  });
});
