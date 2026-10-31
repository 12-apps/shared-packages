'use client';

import { Button, Stack, Typography } from '@mui/material';
import type { ComponentType, JSX, ReactNode } from 'react';

import { NewCardForm } from '../../card/fields';
import { detectBrand, onlyDigits } from '../../card/format';
import { formatCpfOrCnpj, taxIdDigits } from '../../card/tax-id';
import { useCheckoutComponents } from '../../components/checkout/ui';
import { BTN_PRIMARY_SX, T } from '../../components/panel-tokens';
import { useActivationCharge, type ActivationCharge } from '../use-activation-charge';

import { useActivationCopy } from './copy-context';
import { StepPanel } from './notice';
import {
  PayerEmailField,
  useChangePayerEmail,
  usePayerEmailValidator,
  validatePayerEmail,
} from './payer-email-field';
import { FailedState, PassedState, PayerEmailRefusedState } from './states';

/**
 * Step 3 for a provider whose payer pays HERE: tokenize, charge, settle.
 *
 * This is the SAME form a shopper fills in at checkout — the package's own
 * `NewCardForm`, rendered through the host's slot binding, not a second form
 * shaped almost like it. A verification that exercised a different form, a
 * different validator or a different tokenizer would prove something about that
 * path instead of the one that takes real money.
 *
 * The PROTOCOL is `useActivationCharge`'s: validate locally before anything
 * leaves the browser, require a real public key, send only the token, pass only
 * on the server's own answer, and keep the card typed in on a refusal.
 */

/** The host's card-entry providers — its design system and its card words. */
export type CardSurface = ComponentType<{ children: ReactNode }>;

/**
 * The payer e-mail, for a provider that judges it (FUT-4050, FUT-4200). The
 * same rule as the document: editing clears a shown error, blur judges again.
 */
function ChargeEmail({
  verification,
  displayName,
}: {
  verification: ActivationCharge;
  displayName: string;
}): JSX.Element {
  const { payerEmail } = useActivationCopy();
  const { email, setEmail, emailError, setEmailError } = verification;
  return (
    <PayerEmailField
      value={email}
      error={emailError}
      displayName={displayName}
      onChange={(value) => {
        setEmail(value);
        if (emailError) setEmailError(undefined);
      }}
      onBlur={() => {
        if (email) setEmailError(validatePayerEmail(email, payerEmail));
      }}
    />
  );
}

/** The card + tax-id fields and the one button that runs the charge. */
function ChargeForm({
  verification,
  amountLabel,
  displayName,
  validateTaxId,
}: {
  verification: ActivationCharge;
  amountLabel: string | null;
  /** The provider being activated, as the owner knows it. */
  displayName: string;
  validateTaxId: (value: string) => string | undefined;
}): JSX.Element {
  const { taxId, actions } = useActivationCopy();
  const { Input } = useCheckoutComponents();
  const { card, setCard, fieldErrors, setFieldErrors, cpf, setCpf, cpfError, setCpfError, state } =
    verification;
  const submitting = state.kind === 'submitting';

  return (
    <Stack spacing={2} data-testid="verify-charge-form">
      <NewCardForm
        card={card}
        fieldErrors={fieldErrors}
        brand={detectBrand(onlyDigits(card.number))}
        setCard={setCard}
        setFieldErrors={setFieldErrors}
      />
      <Input
        label={taxId.label}
        type="text"
        inputMode="numeric"
        variant="outlined"
        size="md"
        fullWidth
        placeholder={taxId.placeholder}
        value={formatCpfOrCnpj(cpf)}
        error={Boolean(cpfError)}
        helperText={cpfError ?? taxId.hint(displayName)}
        onChange={(event) => {
          setCpf(taxIdDigits(event.target.value));
          // A shown error goes as soon as the owner edits; blur judges again.
          if (cpfError) setCpfError(undefined);
        }}
        // The validator's answer used to be thrown away here, so a wrong
        // document was only reported on submit (FUT-4048). An untouched empty
        // field stays quiet until then.
        onBlur={() => {
          if (cpf) setCpfError(validateTaxId(cpf));
        }}
        data-testid="verify-charge-cpf"
      />
      {verification.payerEmailRequired ? (
        <ChargeEmail verification={verification} displayName={displayName} />
      ) : null}
      <Button
        sx={{ ...BTN_PRIMARY_SX, width: '100%' }}
        disabled={submitting}
        onClick={() => void verification.submit()}
        data-testid="verify-charge-submit"
      >
        {actions.chargeAndActivate(amountLabel)}
      </Button>
    </Stack>
  );
}

/** What a settled card charge says — the only two ends this flow has. */
function CardOutcome({
  state,
  amountLabel,
  displayName,
  onRetry,
  onChangeEmail,
}: {
  state: ActivationCharge['state'];
  amountLabel: string | null;
  displayName: string;
  onRetry: () => void;
  /** Back to the form with the e-mail field in error and focused (FUT-4050). */
  onChangeEmail: () => void;
}): JSX.Element | null {
  if (state.kind === 'passed') {
    return <PassedState amountLabel={amountLabel} refunded={state.refunded} onRetry={onRetry} />;
  }
  if (state.kind === 'failed' && state.payerEmailRefused) {
    return (
      <PayerEmailRefusedState
        displayName={displayName}
        providerMessage={state.providerMessage}
        onChangeEmail={onChangeEmail}
      />
    );
  }
  if (state.kind === 'failed') {
    return (
      <FailedState
        reason={state.reason}
        providerMessage={state.providerMessage}
        onRetry={onRetry}
      />
    );
  }
  return null;
}

/** The step's heading and what the card charge will do. */
function CardIntro({ amountLabel }: { amountLabel: string | null }): JSX.Element {
  const { intro } = useActivationCopy();
  return (
    <Stack spacing={0.5}>
      <Typography sx={{ fontSize: '14px', fontWeight: 650, color: T.ink }} component="h2">
        {intro.title}
      </Typography>
      <Typography sx={{ fontSize: '12.5px', color: T.ink3, lineHeight: 1.5 }}>
        {intro.cardBody(amountLabel)}
      </Typography>
    </Stack>
  );
}

export function CardVerification({
  verifyChargeUrl,
  provider,
  displayName,
  ownerEmail,
  onVerified,
  CardSurface: Surface,
  validateTaxId,
  formatAmount,
}: {
  verifyChargeUrl: string;
  provider: string;
  /** The name the OWNER reads; `provider` beside it is the machine key. */
  displayName: string;
  /** The payer e-mail field's opening value until the endpoint suggests one (FUT-4050). */
  ownerEmail: string;
  onVerified: () => void;
  CardSurface: CardSurface;
  validateTaxId: (value: string) => string | undefined;
  formatAmount: (cents: number) => string;
}): JSX.Element {
  const copy = useActivationCopy();
  const validateEmail = usePayerEmailValidator();
  const verification = useActivationCharge({
    verifyChargeUrl,
    provider,
    email: ownerEmail,
    onVerified,
    validateTaxId,
    validateEmail,
    copy: copy.charge,
  });
  const changeEmail = useChangePayerEmail(verification, displayName);
  // The verification endpoint answers the amount alongside the store's card
  // key, and `useActivationCharge` reads both out of that one body — where this
  // screen's origin asked the same URL a second time for the amount alone.
  //
  // `null` is the window before it has answered. Nothing guesses a cent there,
  // because not every provider will take one, so the sentences below simply do
  // not name an amount until there is one to name.
  const amountLabel =
    verification.amountCents === null ? null : formatAmount(verification.amountCents);
  const settled = verification.state.kind === 'passed' || verification.state.kind === 'failed';

  return (
    <StepPanel dataTestId="verify-charge">
      <CardIntro amountLabel={amountLabel} />

      <CardOutcome
        state={verification.state}
        amountLabel={amountLabel}
        displayName={displayName}
        onRetry={verification.reset}
        onChangeEmail={changeEmail}
      />

      {/*
        No standing "provider is active" banner here.

        It was rendered from `enabled` alone, which is a claim about a stored
        flag and not about whether money moves — so a store whose charges were
        all refused with `403 ACCESS_DENIED` was greeted with "you are
        receiving through this provider" every time it reloaded, directly above
        the form that had just disproven it. What a passing charge says is said
        by `PassedState`, in this session, about a charge that actually
        happened.
      */}
      {settled ? null : (
        <Surface>
          <ChargeForm
            verification={verification}
            amountLabel={amountLabel}
            displayName={displayName}
            validateTaxId={validateTaxId}
          />
        </Surface>
      )}
    </StepPanel>
  );
}
