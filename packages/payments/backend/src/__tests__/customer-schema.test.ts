import { describe, expect, it } from 'vitest';

import {
  customerFieldsFor,
  unionCustomerFields,
  validateCustomer,
} from '../core/customer-schema';
import { CustomerRequirementsError, NoProviderSucceededError } from '../core/errors';
import { createPaymentsGateway } from '../core/gateway';
import type { PaymentProviderAdapter } from '../core/provider';
import { defineProviders } from '../core/registry';
import type { CustomerSchema, PaymentMethodKind } from '../core/types';
import {
  createMemoryAttemptLedger,
  createMemoryChargeStore,
  createMemoryCredentialStore,
} from '../memory';
import { createMemoryWebhookInbox } from '../memory-webhook-inbox';
import { gateIssuesOf, nothingWasAttempted } from '../core/walk-failure';
import { allProviderAdapters } from '../providers/catalog';
import { infinitePayProvider } from '../providers/infinitepay';
import { pagbankProvider } from '../providers/pagbank';
import { stoneProvider } from '../providers/stone';
import { stripeProvider } from '../providers/stripe';
import { STUB_CREDS, TENANT, pixInput } from './fixtures';

/**
 * FUT-595 — buyer requirements declared by the adapter.
 *
 * Three layers under test, one per describe block: what each adapter DECLARES
 * (the contract a new provider must answer), how the declaration VALIDATES
 * collected values, and how the charge walk ENFORCES it before a provider is
 * ever called.
 */

/**
 * Every adapter the package ships, enumerated from the canonical catalog
 * (`providers/catalog.ts`) instead of retyped here.
 *
 * The sweeps below are invariants over ALL adapters, so a hardcoded list
 * defeats them: it keeps passing while the adapter added after it was written
 * — the one nobody has read these invariants for — goes unswept. The catalog is
 * itself pinned against the package's `exports` map by
 * `provider-catalog.test.ts`, so a new adapter reaches this list on its own.
 */
const LIVE_ADAPTERS: PaymentProviderAdapter[] = allProviderAdapters();

/** A CPF/CNPJ pair that satisfy their check digits, and ones that do not. */
const VALID_CPF = '123.456.789-09';
const VALID_CNPJ = '11.222.333/0001-81';
const BAD_CHECK_DIGIT_CPF = '123.456.789-00';
const REPEATED_CPF = '111.111.111-11';
/** The same CNPJ with a broken second verifier digit (…-81 → …-80). */
const BAD_CHECK_DIGIT_CNPJ = '11.222.333/0001-80';
const REPEATED_CNPJ = '11.111.111/1111-11';

const required = (schema: CustomerSchema | undefined, method: PaymentMethodKind) =>
  customerFieldsFor(schema, method)
    .filter((field) => field.required)
    .map((field) => field.key);

const asked = (schema: CustomerSchema | undefined, method: PaymentMethodKind) =>
  customerFieldsFor(schema, method).map((field) => field.key);

describe('per-adapter declarations (the FUT-595 matrix)', () => {
  it('every live adapter declares a customerSchema', () => {
    for (const adapter of LIVE_ADAPTERS) {
      expect(adapter.customerSchema, `${adapter.name} must declare customerSchema`).toBeDefined();
      expect(adapter.customerSchema!.length).toBeGreaterThan(0);
    }
  });

  it('pagbank requires the CPF — the one field criar-pedido marks required', () => {
    const schema = pagbankProvider().customerSchema;
    expect(required(schema, 'PIX')).toEqual(['taxId']);
    expect(required(schema, 'CARD')).toEqual(['taxId']);
    // Phone is asked (forwarded all-or-nothing, FUT-488) but never demanded.
    expect(asked(schema, 'PIX')).toContain('phone');
  });

  it('infinitepay requires the phone and has NO taxId field at all', () => {
    const schema = infinitePayProvider().customerSchema;
    expect(required(schema, 'PIX')).toEqual(['phone']);
    expect(required(schema, 'CARD')).toEqual(['phone']);
    // Not merely optional — absent: linkPayload has nowhere to send a CPF, so
    // asking a buyer for one would collect a document with no destination.
    expect(asked(schema, 'PIX')).not.toContain('taxId');
    expect(asked(schema, 'CARD')).not.toContain('taxId');
  });

  it('no adapter requires name or e-mail for PIX/CARD — the old hardcoded fields', () => {
    // Scoped to PIX and CARD on purpose: a method-scoped demand is legitimate
    // (Stripe's boleto genuinely refuses without billing_details name+email);
    // what must never return is name/e-mail required for EVERYONE, which is
    // the bug the old `CustomerInfo` optionality encoded.
    for (const adapter of LIVE_ADAPTERS) {
      for (const method of ['PIX', 'CARD'] as const) {
        if (!adapter.capabilities.methods.includes(method)) continue;
        const demanded = required(adapter.customerSchema, method);
        expect(demanded, `${adapter.name}/${method}`).not.toContain('name');
        expect(demanded, `${adapter.name}/${method}`).not.toContain('email');
      }
    }
  });

  it('stripe scopes its demands to BOLETO — per-method, not per-provider', () => {
    const schema = stripeProvider().customerSchema;
    // Boleto refuses without billing_details name+email and boleto.tax_id.
    // (A full billing address is ALSO required but CustomerInfo cannot say so
    // yet — see the adapter comment; FUT-596 carries the form-side gap.)
    expect(required(schema, 'BOLETO').sort()).toEqual(['email', 'name', 'taxId']);
    // For card and PIX the tax id is NOT asked — not "optional", absent —
    // and name/e-mail stay optional pre-fill.
    expect(asked(schema, 'CARD')).not.toContain('taxId');
    expect(asked(schema, 'PIX')).not.toContain('taxId');
    expect(required(schema, 'CARD')).toEqual([]);
    expect(required(schema, 'PIX')).toEqual([]);
  });

  it('stone declares honestly: everything it sends is optional, phone unasked', () => {
    const schema = stoneProvider().customerSchema;
    for (const method of stoneProvider().capabilities.methods) {
      expect(required(schema, method)).toEqual([]);
    }
    expect(asked(schema, 'PIX')).not.toContain('phone');
  });
});

describe('validation follows the field type', () => {
  const schema = pagbankProvider().customerSchema;

  it('accepts a CPF and a CNPJ by their check digits', () => {
    for (const taxId of [VALID_CPF, VALID_CNPJ]) {
      expect(validateCustomer(schema, 'PIX', { taxId })).toEqual([]);
    }
  });

  it('rejects a failed check digit, a repeated-digit document, and a wrong length', () => {
    // BOTH document lengths on the reject side, not just the accept side: with
    // only a valid CNPJ pinned, a regression in `cnpjDigit` that accepts
    // ANYTHING 14 digits long (a wrong weight cycle, a loosened `remainder < 2`
    // boundary, `&&` slipping to `||`) keeps the whole suite green — and a
    // buyer's mistyped CNPJ then sails past this gate and is refused by the
    // provider at charge time, on the money path.
    for (const taxId of [
      BAD_CHECK_DIGIT_CPF,
      REPEATED_CPF,
      BAD_CHECK_DIGIT_CNPJ,
      REPEATED_CNPJ,
      '123',
    ]) {
      expect(validateCustomer(schema, 'PIX', { taxId }), taxId).toEqual([
        { field: 'taxId', reason: 'INVALID', required: true },
      ]);
    }
  });

  it('reports a missing required field as MISSING, whitespace included', () => {
    expect(validateCustomer(schema, 'PIX', {})).toEqual([
      { field: 'taxId', reason: 'MISSING', required: true },
    ]);
    expect(validateCustomer(schema, 'PIX', { taxId: '   ' })).toEqual([
      { field: 'taxId', reason: 'MISSING', required: true },
    ]);
  });

  it('PHONE accepts exactly what the PagBank splitter forwards — landlines included', () => {
    // The rule this type mirrors is `customerPhones` (pagbank-http.ts), which
    // checks LENGTH only: DDD + 8 or 9 digits, leading `9` or not. Validating
    // tighter here would refuse a number the wire code sends unchanged, which
    // is the one direction a mirror must never drift in.
    for (const phone of [
      '(11) 98888-7777',
      '+55 11 98888-7777',
      '55 11 98888 7777',
      '3132221100',
      '11888887777',
    ]) {
      expect(validateCustomer(schema, 'PIX', { phone, taxId: VALID_CPF }), phone).toEqual([]);
    }
    for (const phone of ['123', '+1 415 555 0100']) {
      expect(validateCustomer(schema, 'PIX', { phone, taxId: VALID_CPF }), phone).toEqual([
        // Optional at PagBank: reported, never blocking.
        { field: 'phone', reason: 'INVALID', required: false },
      ]);
    }
  });

  it('MOBILE is stricter: InfinitePay demands a mobile, so a landline is INVALID', () => {
    const infinitepay = infinitePayProvider().customerSchema;
    for (const phone of ['(11) 98888-7777', '+55 11 98888-7777', '55 11 98888 7777']) {
      expect(validateCustomer(infinitepay, 'PIX', { phone }), phone).toEqual([]);
    }
    // `3132221100` is a Belo Horizonte LANDLINE and `11888887777` an 11-digit
    // number without the nono dígito. Both are real numbers PagBank forwards
    // happily — and both are refused by InfinitePay's own checkout page, which
    // insists on a mobile. Accepting them here (as one shared PHONE rule did)
    // means the buyer passes our validation, is redirected, and is made to
    // type the phone a second time: precisely the friction collecting the
    // field up front exists to remove.
    for (const phone of ['3132221100', '11888887777', '123', '+1 415 555 0100']) {
      expect(validateCustomer(infinitepay, 'PIX', { phone }), phone).toEqual([
        { field: 'phone', reason: 'INVALID', required: true },
      ]);
    }
  });

  it('stripe BOLETO blocks on name, e-mail and tax id — and only for BOLETO', () => {
    const stripe = stripeProvider().customerSchema;
    expect(validateCustomer(stripe, 'BOLETO', {})).toEqual([
      { field: 'name', reason: 'MISSING', required: true },
      { field: 'email', reason: 'MISSING', required: true },
      { field: 'taxId', reason: 'MISSING', required: true },
    ]);
    expect(
      validateCustomer(stripe, 'BOLETO', {
        name: 'Ana Buyer',
        email: 'ana@example.com',
        taxId: VALID_CPF,
      }),
    ).toEqual([]);
    // The same empty buyer is fine for CARD: the demand is the method's.
    expect(validateCustomer(stripe, 'CARD', {})).toEqual([]);
  });

  it('validates optional fields when present, and marks them non-blocking', () => {
    expect(validateCustomer(schema, 'PIX', { taxId: VALID_CPF, email: 'not-an-email' })).toEqual([
      { field: 'email', reason: 'INVALID', required: false },
    ]);
  });

  it('never validates a field the provider does not ask for', () => {
    // InfinitePay asks for no taxId, Stripe asks none for CARD: garbage there
    // must produce NO issue — this is the "never block a charge" property.
    expect(
      validateCustomer(infinitePayProvider().customerSchema, 'PIX', {
        taxId: 'garbage',
        phone: '11988887777',
      }),
    ).toEqual([]);
    expect(validateCustomer(stripeProvider().customerSchema, 'CARD', { taxId: 'garbage' })).toEqual(
      [],
    );
  });

  it('an adapter that declares nothing asks for nothing', () => {
    expect(customerFieldsFor(undefined, 'PIX')).toEqual([]);
    expect(validateCustomer(undefined, 'PIX', {})).toEqual([]);
  });
});

describe('the union a checkout collects up front', () => {
  it('merges a chain, strictest requiredness winning', () => {
    const union = unionCustomerFields(
      [pagbankProvider().customerSchema, infinitePayProvider().customerSchema],
      'CARD',
    );
    const byKey = Object.fromEntries(union.map((field) => [field.key, field]));
    // PagBank demands the CPF, InfinitePay the phone — the form asks for both
    // BEFORE the first attempt, so failover never strands a charge on a field
    // nobody collected.
    expect(byKey['taxId']).toMatchObject({ required: true, type: 'CPF' });
    // MOBILE, not PHONE, even though PagBank declares the laxer rule and comes
    // FIRST in the chain: the form is filled once, before the first attempt,
    // so a landline that satisfies only PagBank strands the buyer if the walk
    // fails over to InfinitePay. The union takes the strictest answer for the
    // TYPE exactly as it does for `required`.
    expect(byKey['phone']).toMatchObject({ required: true, type: 'MOBILE' });
    expect(byKey['name']).toMatchObject({ required: false });
    expect(byKey['email']).toMatchObject({ required: false });
    expect(union).toHaveLength(4);
  });

  it('the narrower type wins whichever order the chain is in', () => {
    const reversed = unionCustomerFields(
      [infinitePayProvider().customerSchema, pagbankProvider().customerSchema],
      'CARD',
    );
    expect(reversed.find((field) => field.key === 'phone')).toMatchObject({
      required: true,
      type: 'MOBILE',
    });
  });

  it('resolves per method before merging', () => {
    const union = unionCustomerFields([stripeProvider().customerSchema], 'CARD');
    expect(union.map((field) => field.key)).not.toContain('taxId');
  });
});

/** A gateway world over the REAL adapters in stub mode, chain in call order. */
function customerWorld(...chain: Array<'pagbank' | 'infinitepay' | 'stone'>) {
  const credentials = createMemoryCredentialStore();
  const attempts = createMemoryAttemptLedger();
  const gateway = createPaymentsGateway({
    providers: defineProviders({
      pagbank: pagbankProvider(),
      infinitepay: infinitePayProvider(),
      stone: stoneProvider(),
    } as const),
    credentials,
    charges: createMemoryChargeStore(),
    webhooks: createMemoryWebhookInbox(),
    attempts,
  });
  for (const provider of chain) credentials.set(TENANT, provider, STUB_CREDS);
  return { gateway, attempts };
}

describe('charge-walk enforcement (server-side, before the adapter is called)', () => {
  it('a pinned charge missing a required field gets the typed error, field named', async () => {
    const world = customerWorld('pagbank');
    const input = { ...pixInput(), customer: { name: 'Ana', email: 'ana@example.com' } };

    const error = await world.gateway
      .charge(TENANT, input, { provider: 'pagbank' })
      .then(() => null)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(CustomerRequirementsError);
    expect((error as CustomerRequirementsError).issues).toEqual([
      { field: 'taxId', reason: 'MISSING', required: true },
    ]);
  });

  it('a malformed required field blocks the same way — the provider would refuse it', async () => {
    const world = customerWorld('pagbank');
    const input = { ...pixInput(), customer: { taxId: BAD_CHECK_DIGIT_CPF } };

    await expect(world.gateway.charge(TENANT, input, { provider: 'pagbank' })).rejects.toThrow(
      CustomerRequirementsError,
    );
  });

  it('a satisfied schema charges — name and e-mail not required, garbled option ignored', async () => {
    const world = customerWorld('pagbank');
    // No name, no e-mail, an unusable optional phone: only the CPF matters.
    const input = { ...pixInput(), customer: { taxId: VALID_CPF, phone: 'n/a' } };

    const stored = await world.gateway.charge(TENANT, input, { provider: 'pagbank' });
    expect(stored.snapshot).toMatchObject({ provider: 'pagbank', status: 'PENDING' });
  });

  it('failover skips the unmet provider with proof and advances', async () => {
    const world = customerWorld('pagbank', 'infinitepay');
    // Nobody collected a CPF: PagBank cannot be attempted, InfinitePay can —
    // its hosted page collects what it needs (see the REDIRECT rule below).
    const input = {
      ...pixInput(),
      customer: { name: 'Ana' },
      idempotencyKey: 'order-1:0',
    };

    const stored = await world.gateway.charge(TENANT, input);
    expect(stored.snapshot.provider).toBe('infinitepay');

    const rows = await world.attempts.listByIdempotencyKey(TENANT, 'order-1:0');
    const skipped = rows.find((row) => row.provider === 'pagbank');
    // SKIPPED as DEFINITELY_NOT_CHARGED: nothing was sent, so the walk holds
    // its double-charge guarantees while still refusing the doomed attempt.
    expect(skipped).toMatchObject({ outcome: 'SKIPPED' });
    expect(skipped?.error).toContain('taxId');
  });

  it('a gate skip never poisons the retry: same key, field supplied, charge lands', async () => {
    // Hosts reuse the idempotency key while no charge was stored (the ordinal
    // counts stored charges, and a gate skip stores none), so the buyer's
    // retry after supplying the missing CPF arrives under the SAME key. The
    // skip row must not count as "already tried" on resume — nothing was ever
    // sent — or the one recovery the gate's error documents (ask the buyer,
    // retry) is permanently impossible on the unpinned path.
    const world = customerWorld('pagbank');
    const key = 'order-2:0';
    await expect(
      world.gateway.charge(TENANT, {
        ...pixInput('order-2'),
        customer: { name: 'Ana' },
        idempotencyKey: key,
      }),
    ).rejects.toThrow(NoProviderSucceededError);

    const stored = await world.gateway.charge(TENANT, {
      ...pixInput('order-2'),
      customer: { taxId: VALID_CPF },
      idempotencyKey: key,
    });
    expect(stored.snapshot).toMatchObject({ provider: 'pagbank', status: 'PENDING' });
  });

  it('a REDIRECT provider is never blocked — its own page is the collector', async () => {
    const world = customerWorld('infinitepay');
    // Phone is REQUIRED in InfinitePay's schema, yet a charge without one must
    // pass: the hosted checkout demands it from the buyer itself, and what we
    // send is pre-fill. Blocking here would break every InfinitePay store
    // whose buyers type the phone on InfinitePay's page — all of them, today.
    const stored = await world.gateway.charge(
      TENANT,
      { ...pixInput(), customer: {} },
      { provider: 'infinitepay' },
    );
    expect(stored.snapshot.hostedCheckoutUrl).toBeTruthy();
  });

  it('the exemption key stays sound: REDIRECT ⇒ every method settles on the hosted page', async () => {
    // `gateCustomerRequirements` exempts on `tokenization === 'REDIRECT'`, but
    // `ClientTokenization` answers a DIFFERENT question — how card data reaches
    // the provider, not who collects the buyer's fields. The two coincide only
    // while the invariant below holds, and this pins it so a fifth adapter
    // cannot break it silently: a REDIRECT adapter taking one method through a
    // direct API would have that method's real requirement UNENFORCED (the
    // provider 400s instead of a clean DEFINITELY_NOT_CHARGED skip).
    for (const adapter of LIVE_ADAPTERS) {
      if (adapter.capabilities.tokenization !== 'REDIRECT') continue;
      for (const method of adapter.capabilities.methods) {
        const snapshot = await adapter.createCharge(
          { ...pixInput(`redirect-${method}`), method, customer: {} },
          STUB_CREDS,
        );
        expect(snapshot.hostedCheckoutUrl, `${adapter.name}/${method}`).toBeTruthy();
      }
    }
    // The other half of the coupling: `NONE` is documented as legal for a
    // HOSTED checkout, and such an adapter would be wrongly BLOCKED here on
    // fields its own page collects. None declares it today — the moment one
    // does, the exemption needs the per-method hosted flag, not a wider check.
    for (const adapter of LIVE_ADAPTERS) {
      expect(adapter.capabilities.tokenization, adapter.name).not.toBe('NONE');
    }
  });

  it('fields nobody asks for never block: an empty buyer charges at stone', async () => {
    const world = customerWorld('stone');
    const stored = await world.gateway.charge(
      TENANT,
      { ...pixInput(), customer: {} },
      { provider: 'stone' },
    );
    expect(stored.snapshot).toMatchObject({ provider: 'stone', status: 'PENDING' });
  });
});

/**
 * The refusal a host reads off an unpinned walk (FUT-595, retyped by FUT-563).
 *
 * It used to be a STRING the host parsed back with a regex. That failed in the
 * ordinary two-provider case — one recognisable failure beside one that was
 * not, and the host gave up and answered a blanket 5xx — and the regex
 * hardcoded the field names, so the first new field would have silently
 * reverted every such refusal to a 5xx too. The channel is typed now:
 * `kind` says whether anybody was actually asked, and `issues` carries the
 * fields without a format to drift.
 */
describe('the refusal a host reads off an unpinned walk', () => {
  it('carries the gate kind and its typed issues, not a sentence to parse', async () => {
    const world = customerWorld('pagbank');
    const error = await world.gateway
      .charge(TENANT, { ...pixInput('order-3'), customer: { name: 'Ana' } })
      .then(() => null)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(NoProviderSucceededError);
    const failures = (error as NoProviderSucceededError).failures;
    expect(failures.map((failure) => failure.kind)).toEqual(['GATE']);
    expect(failures.flatMap((failure) => [...(failure.issues ?? [])])).toEqual([
      { field: 'taxId', reason: 'MISSING', required: true },
    ]);
  });

  it('says NOTHING WAS ATTEMPTED for a chain of gates and skips alike', async () => {
    // The case the string parser got wrong: a gated head beside a tail skipped
    // for its own, unrelated reason. Nothing went out either way, so the buyer
    // is owed the field — not a payment-outage message.
    const failures = [
      { provider: 'pagbank', message: 'x', kind: 'GATE' as const, issues: [] },
      { provider: 'stone', message: 'y', kind: 'SKIP' as const },
    ];
    expect(nothingWasAttempted(failures)).toBe(true);
    expect(
      nothingWasAttempted([...failures, { provider: 'stripe', message: 'z', kind: 'FAILURE' }]),
    ).toBe(false);
  });

  it('unions the blocking fields across the chain, INVALID beating MISSING', async () => {
    // The buyer cannot be asked to guess which provider will take the charge,
    // so every field that blocked ANY of them has to be named at once.
    expect(
      gateIssuesOf([
        {
          provider: 'pagbank',
          message: 'x',
          kind: 'GATE',
          issues: [{ field: 'taxId', reason: 'MISSING', required: true }],
        },
        {
          provider: 'stone',
          message: 'y',
          kind: 'GATE',
          issues: [
            { field: 'taxId', reason: 'INVALID', required: true },
            { field: 'phone', reason: 'MISSING', required: true },
          ],
        },
      ]),
    ).toEqual([
      { field: 'taxId', reason: 'INVALID', required: true },
      { field: 'phone', reason: 'MISSING', required: true },
    ]);
  });
});

describe('publication in the client config (what the checkout renders from)', () => {
  it('clientConfig carries the active provider schema, normalized', async () => {
    const world = customerWorld('infinitepay');
    const config = await world.gateway.clientConfig(TENANT);
    expect(config?.customerSchema).toEqual(infinitePayProvider().customerSchema);
  });

  it('clientConfigChain carries every member schema, in failover order', async () => {
    const world = customerWorld('pagbank', 'infinitepay');
    const configs = await world.gateway.clientConfigChain(TENANT);
    expect(configs.map((config) => config.provider)).toEqual(['pagbank', 'infinitepay']);
    expect(configs.map((config) => config.customerSchema)).toEqual([
      pagbankProvider().customerSchema,
      infinitePayProvider().customerSchema,
    ]);
  });
});
