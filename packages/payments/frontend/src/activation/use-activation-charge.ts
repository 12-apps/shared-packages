'use client';

import { useCallback, useEffect, useState } from 'react';
import type React from 'react';

import {
  detectBrand,
  onlyDigits,
  tokenizeCard,
  tokenizerFor,
  validateCardNumber,
  validateCpf,
  validateCvv,
  validateExpiry,
  validateHolder,
  type CardDetails,
  type CardFieldErrors,
} from '../card';

import type { ActivationChargeCopy } from './charge-copy';

/**
 * The activation charge for a provider whose payer pays HERE (FUT-463, moved
 * into the package by FUT-763).
 *
 * A connection is not a capability. An OAuth grant completing tells you the
 * owner authorized us; it does not tell you the account can take money, and the
 * gap between those two is where a store ships broken — connected, switched on,
 * and every real shopper met an access error because the integration had never
 * been homologated.
 *
 * So the owner puts their own card through the SAME path a shopper takes — same
 * fields, same validation, same browser-side encryption — for one cent,
 * refunded immediately. Whatever would break for a buyer breaks here, in front
 * of the person who can fix it.
 *
 * The sibling of `useRedirectActivation`, for the other half of the same step:
 * that one is for a provider whose payer leaves for its own page. Both prove
 * the same fact and both leave the SCREEN to the host.
 */

const EMPTY_CARD: CardDetails = { number: '', holder: '', expiry: '', cvv: '' };

export type ActivationChargeState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  /**
   * The charge did not go through — the provider's reason, verbatim enough to
   * act on. `providerMessage` carries the provider's RAW refusal when `reason`
   * is a rewording of it, so the screen can show both.
   */
  | { kind: 'failed'; reason: string; providerMessage?: string }
  /** Money moved. The server has already enabled the provider. */
  | { kind: 'passed'; refunded: boolean };

export interface ActivationChargeOptions {
  /**
   * The host's verify-charge endpoint for this provider.
   *
   * `GET` answers the store's card public key; `POST` takes the tokenized card
   * and makes the charge. A whole URL, not the parts of one — the route shape
   * belongs to the host.
   */
  verifyChargeUrl: string;
  /**
   * Which provider is being activated.
   *
   * Named rather than derived from a capability: two providers can both declare
   * `tokenization: 'PUBLIC_KEY'` while speaking different protocols, so
   * choosing by capability would silently mint one vendor's blob with another's
   * key and report the second's rejection as though the card were bad.
   */
  provider: string;
  /** The signed-in owner's e-mail — the charge's customer record. */
  email: string;
  /** The charge landed; the caller refreshes so the provider shows as active. */
  onVerified: () => void;
  copy: ActivationChargeCopy;
}

export interface ActivationCharge {
  card: CardDetails;
  setCard: React.Dispatch<React.SetStateAction<CardDetails>>;
  fieldErrors: CardFieldErrors;
  setFieldErrors: React.Dispatch<React.SetStateAction<CardFieldErrors>>;
  cpf: string;
  setCpf: (value: string) => void;
  cpfError: string | undefined;
  state: ActivationChargeState;
  submit: () => Promise<void>;
  /** Back to the form from a settled state, to try another card. */
  reset: () => void;
}

/**
 * The store's own card public key, fetched through the VERIFICATION endpoint.
 *
 * Not the checkout one: that reads credentials through the enabled gate, and a
 * provider being verified is by definition still disabled.
 */
function usePublicKey(verifyChargeUrl: string): string | null {
  const [publicKey, setPublicKey] = useState<string | null>(null);

  useEffect(() => {
    const alive = { current: true };
    void fetch(verifyChargeUrl)
      .then((res) => (res.ok ? (res.json() as Promise<{ publicKey?: string | null }>) : null))
      .then((body) => {
        if (alive.current && body?.publicKey) setPublicKey(body.publicKey);
      })
      .catch(() => undefined);
    return () => {
      alive.current = false;
    };
  }, [verifyChargeUrl]);

  return publicKey;
}

/** Local validation — nothing reaches the provider until the card is well-formed. */
function validateAll(card: CardDetails, cpf: string) {
  const brand = detectBrand(onlyDigits(card.number));
  return {
    fieldErrors: {
      number: validateCardNumber(card.number),
      holder: validateHolder(card.holder),
      expiry: validateExpiry(card.expiry),
      cvv: validateCvv(card.cvv, brand),
    } satisfies CardFieldErrors,
    cpfError: validateCpf(cpf),
  };
}

interface ChargeRequest {
  verifyChargeUrl: string;
  provider: string;
  card: CardDetails;
  cpf: string;
  publicKey: string | null;
  email: string;
  copy: ActivationChargeCopy;
}

/**
 * Tokenize the owner's card and ask the server to charge the cent.
 *
 * Strict tokenization on purpose: with no public key there is no encryption, so
 * there would be nothing for the provider to accept or refuse — and a mock
 * token that "passed" would switch on a store that cannot charge.
 */
async function runCharge(request: ChargeRequest): Promise<ActivationChargeState> {
  const tokenizer = tokenizerFor(request.provider);
  if (!tokenizer) {
    return {
      kind: 'failed',
      reason: request.copy.noTokenizer.replace('{provider}', request.provider),
    };
  }

  const tokenized = await tokenizeCard(request.card, request.publicKey, tokenizer);
  if (!tokenized.ok) return { kind: 'failed', reason: tokenized.error };

  try {
    const response = await fetch(request.verifyChargeUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token: tokenized.data.token,
        taxId: onlyDigits(request.cpf),
        holderName: request.card.holder.trim(),
        email: request.email,
      }),
    });
    const body = (await response.json().catch(() => null)) as
      | { ok?: boolean; refunded?: boolean; reason?: string; providerMessage?: string }
      | null;

    if (!body?.ok) {
      return {
        kind: 'failed',
        reason: body?.reason ?? request.copy.chargeFailed,
        providerMessage: body?.providerMessage,
      };
    }
    return { kind: 'passed', refunded: body.refunded === true };
  } catch {
    return { kind: 'failed', reason: request.copy.unreachable };
  }
}

/** The typed-in card + CPF and their validation messages. */
function useCardForm() {
  const [card, setCard] = useState<CardDetails>(EMPTY_CARD);
  const [fieldErrors, setFieldErrors] = useState<CardFieldErrors>({});
  const [cpf, setCpf] = useState('');
  const [cpfError, setCpfError] = useState<string | undefined>(undefined);

  const clear = useCallback(() => {
    setCard(EMPTY_CARD);
    setCpf('');
  }, []);

  return { card, setCard, fieldErrors, setFieldErrors, cpf, setCpf, cpfError, setCpfError, clear };
}

export function useActivationCharge(options: ActivationChargeOptions): ActivationCharge {
  const { verifyChargeUrl, provider, email, onVerified, copy } = options;
  const publicKey = usePublicKey(verifyChargeUrl);
  const form = useCardForm();
  const [state, setState] = useState<ActivationChargeState>({ kind: 'idle' });
  const { card, cpf, setFieldErrors, setCpfError, clear } = form;

  const submit = useCallback(async () => {
    const validation = validateAll(card, cpf);
    setFieldErrors(validation.fieldErrors);
    setCpfError(validation.cpfError);
    if (Object.values(validation.fieldErrors).some(Boolean) || validation.cpfError) return;

    setState({ kind: 'submitting' });
    const next = await runCharge({
      verifyChargeUrl,
      provider,
      card,
      cpf,
      publicKey,
      email,
      copy,
    });

    // The card is cleared only once it has served its purpose; a failure leaves
    // it typed in so the owner can fix one field rather than start over.
    if (next.kind === 'passed') clear();
    setState(next);
    if (next.kind === 'passed') onVerified();
  }, [
    card,
    cpf,
    publicKey,
    verifyChargeUrl,
    provider,
    email,
    copy,
    onVerified,
    setFieldErrors,
    setCpfError,
    clear,
  ]);

  const reset = useCallback(() => {
    setState({ kind: 'idle' });
    setFieldErrors({});
    setCpfError(undefined);
  }, [setFieldErrors, setCpfError]);

  return {
    card: form.card,
    setCard: form.setCard,
    fieldErrors: form.fieldErrors,
    setFieldErrors: form.setFieldErrors,
    cpf: form.cpf,
    setCpf: form.setCpf,
    cpfError: form.cpfError,
    state,
    submit,
    reset,
  };
}
