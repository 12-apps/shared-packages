import { ProviderRequestError } from '../core/errors';
import type { PaymentProviderAdapter } from '../core/provider';
import type { VaultedInstrument, VaultSession } from '../core/vault-types';
import { NAME, pagbankRequest } from './pagbank-http';

/**
 * PagBank card vaulting (FUT-478 / FUT-183) — validating and storing a card
 * WITHOUT a purchase, through the dedicated Card Validation & Storage API
 * (`POST /tokens/cards`, `reference/validar-armanezar-cartao-pagbank`).
 *
 * Until this file existed, a PagBank card could only be saved as a side
 * effect of a PAID order (`card: { encrypted, store: true }` on `/orders`),
 * so a merchant acquiring through PagBank had no way to put a card on file
 * outside a checkout. The dedicated endpoint validates the card and answers
 * a durable `CARD_…` token with no order anywhere near it — and because the
 * validation happens AT STORAGE TIME, a bad card is a refusal at entry
 * rather than a decline at the money moment.
 *
 * The same two-step contract Stripe implements, minus the provider session:
 *
 *   begin     nothing is created at PagBank. The browser gets the account's
 *             public key and tokenizes `PUBLIC_KEY`-style — the exact flow
 *             `clientConfig` already declares for the checkout, so the same
 *             frontend encryption path serves both.
 *   ⟨browser⟩ the SDK encrypts number/expiry/CVV/holder with that key; the
 *             PAN never touches this process.
 *   complete  POST the encrypted blob to `/tokens/cards`. PagBank validates
 *             and stores the card; the response's token id plus display
 *             metadata become the {@link VaultedInstrument} — and nothing
 *             else is kept (`first_digits` and the holder's name are read
 *             and deliberately dropped).
 *
 * There is deliberately NO `forget`: PagBank documents no endpoint that
 * deletes a stored card token (checked against the full API reference
 * index). Omitting the step is the honest declaration the vault contract
 * asks for — the gateway answers `UnsupportedOperationError`, and whether
 * to drop the host-side pointer anyway is the HOST's policy to make. A
 * fabricated success here would report a removal that never happened.
 *
 * The stored token charges as `payment_method.card.id` on `/orders` — the
 * same spelling an order-derived saved card already uses (`cardInstrument`
 * in `pagbank.ts`), and `reference/criar-pagar-pedido-com-token-pagbank`
 * shows the same `CARD_…` id shape this endpoint answers. That is the
 * documented contract this module is built to; whether a `/tokens/cards`
 * token charges identically to an order-derived one in practice is the
 * ticket's open question and still needs a live sandbox confirmation.
 */

/** The stored-card body `POST /tokens/cards` answers with. */
interface PagBankStoredCard {
  id?: string;
  brand?: string;
  first_digits?: string;
  last_digits?: string;
  exp_month?: string | number;
  exp_year?: string | number;
  holder?: { name?: string };
}

/**
 * PagBank spells display expiry as strings (`"04"`, `"2026"`); the vault
 * contract wants numbers. Anything unparseable is dropped rather than sent
 * on as `NaN` — the fields are display-only, so absent beats wrong.
 */
function displayNumber(value: string | number | undefined): number | undefined {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : undefined;
}

const begin: NonNullable<PaymentProviderAdapter['vault']>['begin'] = async (
  _input,
  credentials,
): Promise<VaultSession> => {
  // No session object exists at PagBank to stamp `reference` into — `begin`
  // only equips the browser. The ownership story lives on `complete`.
  const publicKey = credentials.fields['publicKey'] || undefined;
  if (!publicKey && !credentials.stub) {
    // Without the key the browser cannot encrypt, so the flow is already dead
    // — better refused here, with a reason, than as an opaque SDK failure on
    // the tenant's screen. Stub connections are exempt: no key is exactly the
    // state the host's mock tokenization exists for.
    throw new ProviderRequestError(
      NAME,
      'PagBank connection carries no public key (Chave pública); card vaulting needs one.',
      { retriable: false },
    );
  }
  return { provider: NAME, tokenization: 'PUBLIC_KEY', publicKey };
};

const complete: NonNullable<PaymentProviderAdapter['vault']>['complete'] = async (
  input,
  credentials,
): Promise<VaultedInstrument> => {
  // The no-session flow: what the browser hands back is the encrypted card
  // blob itself, via `VaultCompleteInput.token`. Unlike Stripe's `sessionId`
  // there is no cross-tenant object to hijack here — the blob names nothing
  // at the provider until THIS request stores it, so the reference check the
  // contract demands of session-based providers has nothing to bind against
  // and ownership reduces to "whoever posts the blob vaults their own card".
  if (!input.token) {
    throw new ProviderRequestError(
      NAME,
      'PagBank vaults with no session step; completion needs the browser-encrypted card blob.',
      { retriable: false },
    );
  }
  if (credentials.stub) return stubVaultedCard(input.reference, input.token);

  const card = await pagbankRequest<PagBankStoredCard>('/tokens/cards', credentials, {
    method: 'POST',
    // `encrypted` alone: the holder's name and every card field ride inside
    // the blob the browser SDK produced. A validation refusal comes back as
    // a 400 with `error_messages`, which `pagbankRequest` raises as a
    // non-retriable ProviderRequestError — the redaction there already
    // replaces `encrypted` in the captured request, so the blob (enough to
    // charge with) is never written anywhere.
    body: { encrypted: input.token },
  });
  if (!card.id) {
    throw new ProviderRequestError(NAME, 'PagBank /tokens/cards response carried no token id.', {
      retriable: false,
    });
  }
  // Display metadata ONLY — no PAN, no `first_digits`, no holder. What is
  // persisted downstream is exactly this object, so what it omits is as
  // deliberate as what it carries.
  return {
    provider: NAME,
    instrumentId: card.id,
    brand: card.brand,
    last4: card.last_digits,
    expMonth: displayNumber(card.exp_month),
    expYear: displayNumber(card.exp_year),
  };
};

/**
 * Deterministic stub vault, no network — the same contract every adapter
 * operation honours, and the same magic `-declined` suffix `stubCharge`
 * reads, so a host can exercise the validation-refusal path (a bad card
 * caught at entry) without a live account.
 */
function stubVaultedCard(reference: string, token: string): VaultedInstrument {
  if (token.endsWith('-declined')) {
    throw new ProviderRequestError(NAME, `${NAME} refused to validate the card (stub).`, {
      retriable: false,
      httpStatus: 400,
    });
  }
  return {
    provider: NAME,
    instrumentId: `stub_${NAME}_vault_${reference}`,
    brand: 'visa',
    last4: '4242',
    expMonth: 12,
    expYear: 2030,
  };
}

export const pagbankVault: NonNullable<PaymentProviderAdapter['vault']> = {
  begin,
  complete,
  // No `forget` — see the module doc: PagBank publishes no token-delete
  // endpoint, and claiming the capability would fake removals.
};
