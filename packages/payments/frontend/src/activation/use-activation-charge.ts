'use client';

import { useCallback, useEffect, useState } from 'react';
import type React from 'react';

import {
  detectBrand,
  onlyDigits,
  tokenizeCard,
  tokenizerFor,
  validateCardNumber,
  validateCpfOrCnpj,
  validateCvv,
  validateExpiry,
  validateHolder,
  type CardDetails,
  type CardFieldErrors,
} from '../card';

import type { ActivationChargeCopy } from './charge-copy';
import { usePayerEmail } from './use-payer-email';
import type { CardCopy } from '../card/copy';

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
 * fields, same validation, same browser-side encryption — for the smallest
 * amount that provider will actually accept, refunded immediately. Whatever
 * would break for a buyer breaks here, in front of the person who can fix it.
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
  | {
      kind: 'failed';
      reason: string;
      providerMessage?: string;
      /** The provider refused the payer's e-mail itself (FUT-4050). */
      payerEmailRefused?: boolean;
    }
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
  /**
   * What the payer e-mail field opens with until the endpoint answers its own
   * (FUT-4050) — usually the signed-in owner's. The OWNER decides what is sent:
   * the field is theirs to change, and the charge goes out with what it holds.
   */
  email: string;
  /**
   * Judges the payer e-mail on blur and on submit. Omitted, nothing is judged
   * here: a blank one is sent blank and the server falls back to the host's.
   */
  validateEmail?: (value: string) => string | undefined;
  /** The charge landed; the caller refreshes so the provider shows as active. */
  onVerified: () => void;
  /**
   * The host's holder-document validator — the SAME one the field runs on blur,
   * so the submit cannot refuse what the blur accepted (FUT-4048). Omitted, a
   * CPF or a CNPJ is accepted, refused in the card pack's own words.
   */
  validateTaxId?: (value: string) => string | undefined;
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
  /** Show (or clear) the holder document's error — the field's blur sets it (FUT-4048). */
  setCpfError: (error: string | undefined) => void;
  /** The payer e-mail the charge will be sent with (FUT-4050). */
  email: string;
  setEmail: (value: string) => void;
  emailError: string | undefined;
  /**
   * Whether this provider judges the payer e-mail (FUT-4200). Only then is the
   * field shown and validated; elsewhere the suggestion is sent as it is.
   */
  payerEmailRequired: boolean;
  setEmailError: (error: string | undefined) => void;
  /**
   * What this charge will COST, in cents — `null` until the endpoint answers.
   *
   * Not always one cent, which is the whole reason it is asked for rather than
   * assumed: at least one provider refuses a one-cent total outright, so its
   * verification charge is worth more, and the minimum is a fact about that
   * provider's API rather than a number this package may pick.
   *
   * `null` rather than a fallback for the same reason the copy has no
   * defaults: what to put on a button before the truth arrives is the host's
   * sentence to write, and a package guessing here would have the screen
   * promise one amount and charge another.
   */
  amountCents: number | null;
  state: ActivationChargeState;
  submit: () => Promise<void>;
  /** Back to the form from a settled state, to try another card. */
  reset: () => void;
}

/**
 * What the verification endpoint says about the charge BEFORE it is made.
 *
 * Two facts, one request, because the endpoint answers both in one body and
 * they are needed on the same screen at the same moment. They were two asks
 * for the same URL — the key read here, the amount read by the host — which is
 * one request per render pass more than the truth costs, and two places for
 * the answer to be interpreted differently.
 *
 * The endpoint is the VERIFICATION one, not checkout's: that reads credentials
 * through the enabled gate, and a provider being verified is by definition
 * still disabled.
 */
interface ActivationProbe {
  publicKey: string | null;
  amountCents: number | null;
  /** Who the host thinks is paying — the e-mail field's opening value. */
  payerEmail: string | null;
  /** The provider judges the payer e-mail, so the owner is asked (FUT-4200). */
  payerEmailRequired: boolean;
}

/** Before the endpoint has answered, every fact is simply unknown. */
const UNKNOWN_PROBE: ActivationProbe = {
  publicKey: null,
  amountCents: null,
  payerEmail: null,
  payerEmailRequired: false,
};

/** The endpoint's `GET` body — every field optional; a host may answer none. */
interface ProbeBody {
  publicKey?: string | null;
  amountCents?: number | null;
  payerEmail?: string | null;
  payerEmailRequired?: boolean;
}

function readProbe(body: ProbeBody | null): ActivationProbe {
  return {
    publicKey: body?.publicKey ? body.publicKey : null,
    amountCents: typeof body?.amountCents === 'number' ? body.amountCents : null,
    payerEmail: typeof body?.payerEmail === 'string' && body.payerEmail ? body.payerEmail : null,
    payerEmailRequired: body?.payerEmailRequired === true,
  };
}

function useActivationProbe(verifyChargeUrl: string): ActivationProbe {
  const [probe, setProbe] = useState<ActivationProbe>(UNKNOWN_PROBE);

  useEffect(() => {
    const alive = { current: true };
    // Forgotten FIRST, before the new answer is asked for. A screen that moves
    // between providers keeps this hook mounted, and holding the previous
    // provider's key across the gap would tokenize the card with one vendor's
    // key and send the blob to another — which arrives as that second
    // provider's refusal, reading exactly like a bad card.
    setProbe(UNKNOWN_PROBE);
    void fetch(verifyChargeUrl)
      .then((res) => (res.ok ? (res.json() as Promise<ProbeBody>) : null))
      .then((body) => {
        if (alive.current) setProbe(readProbe(body));
      })
      .catch(() => undefined);
    return () => {
      alive.current = false;
    };
  }, [verifyChargeUrl]);

  return probe;
}

/** Local validation — nothing reaches the provider until the card is well-formed. */
function validateAll(
  card: CardDetails,
  cpf: string,
  copy: CardCopy,
  validateTaxId: (value: string) => string | undefined,
) {
  const brand = detectBrand(onlyDigits(card.number));
  const fields = copy.fields;
  return {
    fieldErrors: {
      number: validateCardNumber(card.number, fields),
      holder: validateHolder(card.holder, fields),
      expiry: validateExpiry(card.expiry, fields),
      cvv: validateCvv(card.cvv, fields, brand),
    } satisfies CardFieldErrors,
    cpfError: validateTaxId(cpf),
  };
}

function hasAnyError(validation: ReturnType<typeof validateAll>): boolean {
  return Object.values(validation.fieldErrors).some(Boolean) || Boolean(validation.cpfError);
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

  const tokenized = await tokenizeCard(request.card, request.publicKey, request.copy.card, tokenizer);
  if (!tokenized.ok) return { kind: 'failed', reason: tokenized.error };

  try {
    const response = await fetch(request.verifyChargeUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token: tokenized.data.token,
        taxId: onlyDigits(request.cpf),
        holderName: request.card.holder.trim(),
        email: request.email.trim(),
      }),
    });
    return readChargeAnswer((await response.json().catch(() => null)) as ChargeAnswer | null, request.copy);
  } catch {
    return { kind: 'failed', reason: request.copy.unreachable };
  }
}

/** The verify-charge `POST` body — every field optional, as a host may send less. */
interface ChargeAnswer {
  ok?: boolean;
  refunded?: boolean;
  reason?: string;
  providerMessage?: string;
  payerEmailRefused?: boolean;
}

/** Only the server's own `ok` passes; anything else is the refusal it gave, or ours. */
function readChargeAnswer(body: ChargeAnswer | null, copy: ActivationChargeCopy): ActivationChargeState {
  if (body?.ok) return { kind: 'passed', refunded: body.refunded === true };
  return {
    kind: 'failed',
    reason: body?.reason ?? copy.chargeFailed,
    providerMessage: body?.providerMessage,
    ...(body?.payerEmailRefused === true ? { payerEmailRefused: true } : {}),
  };
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
  const { verifyChargeUrl, provider, onVerified, validateTaxId, validateEmail, copy } = options;
  const probe = useActivationProbe(verifyChargeUrl);
  const form = useCardForm();
  const payer = usePayerEmail(options.email, probe.payerEmail);
  const { email, setEmailError } = payer;
  const [state, setState] = useState<ActivationChargeState>({ kind: 'idle' });
  const { clear, ...fields } = form;
  const { card, cpf, setFieldErrors, setCpfError } = fields;

  const submit = useCallback(async () => {
    const validation = validateAll(
      card,
      cpf,
      options.copy.card,
      validateTaxId ?? ((value) => validateCpfOrCnpj(value, options.copy.card.fields)),
    );
    const emailError = probe.payerEmailRequired ? validateEmail?.(email) : undefined;
    setFieldErrors(validation.fieldErrors);
    setCpfError(validation.cpfError);
    setEmailError(emailError);
    if (hasAnyError(validation) || emailError) return;

    setState({ kind: 'submitting' });
    const next = await runCharge({
      verifyChargeUrl,
      provider,
      card,
      cpf,
      publicKey: probe.publicKey,
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
    probe.publicKey,
    probe.payerEmailRequired,
    verifyChargeUrl,
    provider,
    email,
    copy,
    onVerified,
    validateTaxId,
    validateEmail,
    setFieldErrors,
    setCpfError,
    setEmailError,
    clear,
  ]);

  const reset = useCallback(() => {
    setState({ kind: 'idle' });
    setFieldErrors({});
    setCpfError(undefined);
    setEmailError(undefined);
  }, [setFieldErrors, setCpfError, setEmailError]);

  return {
    ...fields,
    ...payer,
    payerEmailRequired: probe.payerEmailRequired,
    amountCents: probe.amountCents,
    state,
    submit,
    reset,
  };
}
