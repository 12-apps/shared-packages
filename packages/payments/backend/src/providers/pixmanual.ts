import { CredentialsError, UnsupportedOperationError } from '../core/errors';
import type { PaymentProviderAdapter } from '../core/provider';
import { resolvePaymentsCopy, type PaymentsCopySource } from '../copy-source';
import type {
  ChargeInput,
  ChargeSnapshot,
  CredentialFieldSpec,
  ProbeOutcome,
  ResolvedCredentials,
} from '../core/types';
import { sanitizeTxId, staticBrCode } from './pix-manual/br-code';
import type { PixManualCopy } from './pix-manual/copy';
import { MERCHANT_CITY_MAX, MERCHANT_NAME_MAX, readSettings, settingsChecks } from './pix-manual/fields';

/**
 * Pix manual — the store's OWN Pix key, shown to the buyer as a static BR Code
 * for the exact amount, and confirmed BY HAND: someone at the store sees the
 * transfer on the bank statement and presses "Confirmar".
 *
 * There is no PSP behind it, so nothing ever notifies us and nothing can be
 * asked. That shapes every member below:
 *
 * - `capabilities.confirmation: 'MANUAL'` tells the gateway, the buyer's
 *   screen and the host that PAID only ever comes from
 *   `gateway.confirmManualCharge` — never from a webhook or a poll.
 * - `getCharge` answers PENDING forever: the stored charge is the truth, and
 *   the store is forward-only, so it never undoes a confirmation.
 * - `webhook.verify` refuses everything, so the public webhook route can
 *   never be used to forge a confirmation.
 * - STUB mode is the same code as live (there is no network to fake) and
 *   never mints a `stub_` id: hosts auto-settle those, which here would
 *   confirm a payment nobody checked. Its one difference is that a field the
 *   store left blank falls back to a fixed demo value, so a stub connection
 *   charges with nothing configured, as every adapter's stub must.
 */

export const NAME = 'pixmanual';
/** Prefix of every charge id this adapter raises — distinct from the txid alone. */
const CHARGE_ID_PREFIX = 'pixmanual_';

/** What a STUB connection charges with for any field left blank — never used live. */
const STUB_FIELDS: Readonly<Record<string, string>> = {
  pixKey: 'pix-manual@stub.example',
  merchantName: 'Loja de teste',
  merchantCity: 'Sao Paulo',
};

/** The fields a charge or a probe reads: the store's own, plus the demo ones under stub. */
function fieldsOf(credentials: ResolvedCredentials): Readonly<Record<string, string>> {
  if (!credentials.stub) return credentials.fields;
  const filled = Object.fromEntries(Object.entries(credentials.fields).filter(([, value]) => value.trim() !== ''));
  return { ...STUB_FIELDS, ...filled };
}

function credentialSchema(fields: PixManualCopy['fields']): CredentialFieldSpec[] {
  return [
    { key: 'pixKey', label: fields.pixKey, secret: false, required: true, mono: true, confirmOnSave: true, helperText: fields.pixKeyHelp },
    { key: 'merchantName', label: fields.merchantName, secret: false, required: true, helperText: fields.merchantNameHelp, pattern: `^.{1,${MERCHANT_NAME_MAX}}$` },
    { key: 'merchantCity', label: fields.merchantCity, secret: false, required: true, helperText: fields.merchantCityHelp, pattern: `^.{1,${MERCHANT_CITY_MAX}}$` },
    { key: 'confirmWithinMinutes', label: fields.confirmWithinMinutes, secret: false, required: false, optional: true, placeholder: '30', helperText: fields.confirmWithinMinutesHelp, pattern: '^\\d{0,4}$' },
  ];
}

function verify(credentials: ResolvedCredentials, copy: PixManualCopy): Promise<ProbeOutcome> {
  const settings = readSettings(fieldsOf(credentials));
  const checks = settingsChecks(settings, copy.checks);
  if (settings.problems.length > 0) {
    return Promise.resolve({ ok: false, fault: 'REFUSED', message: copy.invalid, checks });
  }
  return Promise.resolve({ ok: true, message: copy.ready, checks });
}

/** The charge id for one attempt: the txid the payer's app quotes, under this adapter's prefix. */
export function pixManualChargeId(reference: string): string {
  return `${CHARGE_ID_PREFIX}${sanitizeTxId(reference)}`;
}

function createCharge(input: ChargeInput, credentials: ResolvedCredentials, now: () => number): ChargeSnapshot {
  if (input.method !== 'PIX') throw new UnsupportedOperationError(NAME, `createCharge(${input.method})`);
  const settings = readSettings(fieldsOf(credentials));
  if (settings.problems.length > 0 || settings.pixKey === null || settings.windowMinutes === null) {
    throw new CredentialsError(NAME, `Pix manual is not configured: ${settings.problems.join(', ')}.`);
  }
  const qrText = staticBrCode({
    pixKey: settings.pixKey,
    merchantName: settings.merchantName,
    merchantCity: settings.merchantCity,
    amountCents: input.amount.amountCents,
    txid: input.reference,
  });
  return {
    provider: NAME,
    providerChargeId: pixManualChargeId(input.reference),
    reference: input.reference,
    status: 'PENDING',
    amount: input.amount,
    method: 'PIX',
    pix: { qrText, expiresAt: new Date(now() + settings.windowMinutes * 60_000).toISOString() },
  };
}

/** What a read or a void can say about a charge only the store can settle. */
function snapshotOf(providerChargeId: string, status: 'PENDING' | 'CANCELED'): ChargeSnapshot {
  return { provider: NAME, providerChargeId, status, amount: { amountCents: 0, currency: 'BRL' }, method: 'PIX' };
}

export interface PixManualOptions {
  /** The clock a charge's window is measured from — injectable for tests. */
  now?: () => number;
}

export function pixManualProvider(
  source: PaymentsCopySource<PixManualCopy>,
  options: PixManualOptions = {},
): PaymentProviderAdapter {
  const copy = (locale?: string): PixManualCopy => resolvePaymentsCopy(source, locale);
  const now = options.now ?? Date.now;

  return {
    name: NAME,
    displayName: copy().displayName,
    authMode: 'credentials',
    capabilities: {
      methods: ['PIX'],
      savedCards: false,
      refunds: false,
      partialRefunds: false,
      splits: false,
      webhooks: false,
      tokenization: 'NONE',
      confirmation: 'MANUAL',
      // No sandbox at a bank you have no API with: every code is real money.
      environments: ['PRODUCTION'],
    },
    credentialSchema: ({ locale }) => credentialSchema(copy(locale ?? undefined).fields),
    customerSchema: [{ key: 'name', type: 'NAME', required: false }],

    verifyCredentials: (credentials, locale) => verify(credentials, copy(locale ?? undefined)),

    // `async`, so a refusal is a rejected promise like every adapter's, never a synchronous throw.
    createCharge: async (input, credentials) => createCharge(input, credentials, now),
    getCharge: (providerChargeId) => Promise.resolve(snapshotOf(providerChargeId, 'PENDING')),
    cancelCharge: (providerChargeId) => Promise.resolve(snapshotOf(providerChargeId, 'CANCELED')),

    webhook: {
      verify: () => Promise.resolve(false),
      parse: () => Promise.resolve([]),
    },

    clientConfig() {
      return { provider: NAME, tokenization: 'NONE' };
    },
  };
}
