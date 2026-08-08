import type { CustomerInfo, WalletInstrument } from '../core/types';

import type { CheckoutChargeDraft } from './types';

/**
 * THE ONE PLACE A CHARGE BODY IS READ (FUT-740).
 *
 * ## The published wire shape is a hard constraint
 *
 * `@12-apps/payments-frontend@1.4.x` is already deployed in browsers, and its
 * `chargeCard` posts a FLAT body:
 *
 * ```json
 * { "orderId": "…", "token": "…", "tokensByProvider": {…},
 *   "saveCard": true, "cardMeta": {…}, "taxId": "…" }
 * ```
 *
 * This mount cannot rename those fields in the same release that introduces it —
 * exactly the reasoning `payableRefField` already carries for `orderId`, applied
 * to the rest of the body instead of to one field of it. A mount that only read
 * a nested `card` block received `card: undefined` from every shipped client,
 * charged nothing, and told the buyer their card was declined.
 *
 * ## Both shapes, and which one is canonical
 *
 * CANONICAL is the nested shape — `{ card: { token, savedCardToken,
 * tokensByProvider }, saveInstrument, instrumentDisplay, customer }` — because
 * it says what each field IS in the library's own vocabulary, with no host's
 * word for an order in it. New clients should send it, and it wins field by
 * field where both are present.
 *
 * ACCEPTED, permanently, is the flat shape above. It is not a deprecation
 * shim with a removal date: a browser tab open across a deploy sends it, and a
 * checkout that refuses it takes the buyer's money nowhere.
 *
 * ## `token` names two different things, and only the vault knows which
 *
 * The flat body's single `token` is "a fresh token, or a saved card's id for
 * reuse" — the shipped client's own words. The nested shape splits them; the
 * flat one cannot, so a draft normalized from it is marked
 * `ambiguousInstrument` and the resolution asks the vault before deciding
 * (`flows-charge.ts`). That is what the replaced host route did too, and it is
 * why "the vault does not own this id" must not become a refusal there.
 */

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** A non-empty string, or undefined. An empty field is an absent field. */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * The per-provider instruments (FUT-563), keyed by whatever name the BROWSER
 * used. Never compared against a literal here — the gateway matches the keys
 * against the merchant's own chain.
 */
function tokensByProvider(value: unknown): Record<string, string> | undefined {
  const raw = record(value);
  if (!raw) return undefined;
  const entries: [string, string][] = [];
  for (const [provider, token] of Object.entries(raw)) {
    const minted = text(token);
    if (minted) entries.push([provider, minted]);
  }
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/**
 * A wallet instrument (FUT-471/472), when the body carries a well-formed one.
 * Both halves are mandatory on PagBank's wire, so a wallet missing either is
 * an absent wallet — never a `{ type }` husk the adapter would forward.
 */
function walletOf(value: unknown): WalletInstrument | undefined {
  const raw = record(value);
  if (!raw) return undefined;
  const type = raw.type;
  const key = text(raw.key);
  if ((type !== 'GOOGLE_PAY' && type !== 'APPLE_PAY') || !key) return undefined;
  return { type, key };
}

/** The card block's fields, from whichever wire shape carried each. */
function cardOf(
  nested: Record<string, unknown> | null,
  raw: Record<string, unknown>,
): NonNullable<CheckoutChargeDraft['card']> {
  const minted = tokensByProvider(nested ? nested.tokensByProvider : raw.tokensByProvider);
  const token = text(nested ? nested.token : raw.token);
  const savedCardToken = text(nested?.savedCardToken);
  const wallet = walletOf(nested ? nested.wallet : raw.wallet);
  return {
    ...(token ? { token } : {}),
    ...(savedCardToken ? { savedCardToken } : {}),
    ...(minted ? { tokensByProvider: minted } : {}),
    ...(wallet ? { wallet } : {}),
  };
}

/** The instrument half of a draft, from whichever shape carried it. */
function instrumentOf(raw: Record<string, unknown>): Pick<
  CheckoutChargeDraft,
  'card' | 'ambiguousInstrument'
> {
  const nested = record(raw.card);
  const card = cardOf(nested, raw);
  if (Object.keys(card).length === 0) return {};
  // ONLY the flat shape conflates the two kinds. A nested `token` was sent by a
  // client that had a `savedCardToken` field available and chose not to use it,
  // so it means what it says.
  return { card, ...(!nested && card.token ? { ambiguousInstrument: true } : {}) };
}

const CUSTOMER_KEYS = ['name', 'email', 'taxId', 'phone'] as const;

/**
 * The buyer fields THIS request collected.
 *
 * The flat fallback is `taxId` and nothing else, deliberately: it is the one
 * buyer field the published client sends with a charge, and reaching for a
 * top-level `name` or `email` would start interpreting a body whose other keys
 * belong entirely to the host.
 */
function customerOf(raw: Record<string, unknown>): Partial<CustomerInfo> | undefined {
  const nested = record(raw.customer) ?? {};
  const collected: Partial<CustomerInfo> = {};
  for (const key of CUSTOMER_KEYS) {
    const value = text(nested[key]);
    if (value) collected[key] = value;
  }
  collected.taxId ??= text(raw.taxId);
  if (collected.taxId === undefined) delete collected.taxId;
  return Object.keys(collected).length > 0 ? collected : undefined;
}

/** Normalize a `/charge` body — either wire shape — into the library's draft. */
export function chargeDraftOf(body: unknown): CheckoutChargeDraft {
  const raw = record(body) ?? {};
  const save = typeof raw.saveInstrument === 'boolean' ? raw.saveInstrument : raw.saveCard;
  const display = raw.instrumentDisplay ?? raw.cardMeta;
  const customer = customerOf(raw);
  return {
    ...instrumentOf(raw),
    ...(save === true ? { saveInstrument: true } : {}),
    ...(display === undefined ? {} : { instrumentDisplay: display }),
    ...(customer ? { customer } : {}),
  };
}
