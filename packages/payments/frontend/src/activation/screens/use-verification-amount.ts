'use client';

import { useEffect, useState } from 'react';

/**
 * What the activation charge will actually cost, per provider.
 *
 * NOT always a cent. At least one provider refuses a one-cent total outright —
 * InfinitePay answers `422 {"errors":{"items":["Total price must be greater
 * than 1"]}}`, where the "1" is one REAL — so its verification charges more,
 * and a button promising one figure while charging another would be exactly the
 * kind of lie this flow exists to remove.
 *
 * Read from the host's endpoint rather than assumed here: the minimum is a fact
 * about the provider's API, discovered from its own refusal, and a constant in
 * this package would be wrong for the first adopter whose provider disagrees.
 *
 * `null` until it answers — the caller decides what a sentence says before
 * there is an amount to name, because that is a sentence and sentences are the
 * host's. The CARD flow does not need this at all: `useActivationCharge` reads
 * the amount out of the same body it reads the store's card key from.
 */
/** The endpoint's `GET` body, every field optional. */
interface ProbeBody {
  amountCents?: number;
  payerEmail?: string | null;
  payerEmailRequired?: boolean;
}

export function useVerificationAmount(verifyChargeUrl: string): {
  amountCents: number | null;
  /** The payer e-mail the host suggests, from the same body (FUT-4050). */
  payerEmail: string | null;
  /**
   * The provider judges that e-mail, so the step asks for it (FUT-4200).
   * `null` until the endpoint answers: the pay button waits for it, so no link
   * is minted for an e-mail nobody was asked for. A failed read is `false`.
   */
  payerEmailRequired: boolean | null;
} {
  const [amountCents, setAmountCents] = useState<number | null>(null);
  const [payerEmail, setPayerEmail] = useState<string | null>(null);
  const [payerEmailRequired, setPayerEmailRequired] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    // Forgotten first, as the card probe does: a screen moving between
    // providers must not keep the previous one's answers.
    setAmountCents(null);
    setPayerEmail(null);
    setPayerEmailRequired(null);
    void fetch(verifyChargeUrl)
      .then((res) => (res.ok ? (res.json() as Promise<ProbeBody>) : null))
      .then((body) => {
        if (!active) return;
        if (typeof body?.amountCents === 'number') setAmountCents(body.amountCents);
        if (typeof body?.payerEmail === 'string' && body.payerEmail) setPayerEmail(body.payerEmail);
        setPayerEmailRequired(body?.payerEmailRequired === true);
      })
      // A failed read leaves the amount unnamed rather than guessed — the
      // screen still renders, and it is corrected the moment an answer lands.
      .catch(() => {
        if (active) setPayerEmailRequired(false);
      });
    return () => {
      active = false;
    };
  }, [verifyChargeUrl]);

  return { amountCents, payerEmail, payerEmailRequired };
}
