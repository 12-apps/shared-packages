import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChargeInput } from '../core/types';
import { pagbankProvider } from '../providers/pagbank';
import { PT_BR_PAGBANK_COPY } from '../providers/pt-BR';
import { cardInput, pixInput } from './fixtures';

/**
 * PagBank PRODUCTION's request contract, as production has enforced it on us
 * (FUT-4073).
 *
 * The sandbox and the published schema both accepted bodies that production
 * refused, and each refusal was silently failed over to the next provider:
 *
 *   - 40002 `x-idempotency-key` "must match the pattern [\w-]+" — our attempt
 *     keys carry a `:` (FUT-4069);
 *   - 40001 `customer.phones[0].type` "must not be null" — `type` is absent
 *     from the item schema and required anyway (FUT-4073).
 *
 * So every order this adapter can build is checked here against the rules
 * production applies, across the buyer data a real checkout produces: phones
 * typed every way a person types them, CPFs and CNPJs with and without their
 * mask, order references with suffixes, amounts from the R$ 1,00 floor up.
 * One case per input and method, so a regression names the input that broke.
 */

const CREDS = {
  environment: 'PRODUCTION' as const,
  fields: { token: 'tok_prod', notificationUrl: 'https://paladira.com/api/webhooks/pagseguro/acme/notifications' },
};

interface SentPhone {
  country?: unknown;
  area?: unknown;
  number?: unknown;
  type?: unknown;
}

interface SentOrder {
  reference_id?: unknown;
  customer: { name?: unknown; email?: unknown; tax_id?: unknown; phones?: SentPhone[] };
  items: { reference_id?: unknown; name?: unknown; quantity?: unknown; unit_amount?: unknown }[];
  charges: {
    reference_id?: unknown;
    description?: unknown;
    amount: { value?: unknown; currency?: unknown };
    payment_method: { type?: unknown; pix?: { expiration_date?: unknown } };
  }[];
  notification_urls?: unknown[];
}

interface Sent {
  body: SentOrder;
  headers: Record<string, string>;
}

function mockFetch(kind: 'pix' | 'card') {
  const response =
    kind === 'pix'
      ? { id: 'ORDE_1', charges: [{ id: 'CHAR_1', status: 'WAITING', qr_code: { text: 'emv' } }] }
      : { id: 'ORDE_1', charges: [{ id: 'CHAR_1', status: 'PAID', payment_response: { code: '20000' } }] };
  const spy = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => response,
    text: async () => JSON.stringify(response),
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Build the order the adapter sends for `input`, as it went over the wire. */
async function send(kind: 'pix' | 'card', patch: (input: ChargeInput) => ChargeInput): Promise<Sent> {
  const spy = mockFetch(kind);
  const base = kind === 'pix' ? pixInput() : cardInput();
  await pagbankProvider(PT_BR_PAGBANK_COPY).createCharge(patch(base), CREDS);
  const init = spy.mock.calls[0]?.[1] as { body: string; headers: Record<string, string> };
  return { body: JSON.parse(init.body) as SentOrder, headers: init.headers };
}

const DIGITS = /^\d+$/;
const PHONE_TYPES = ['MOBILE', 'HOME', 'BUSINESS'];

/** Every rule production applies to an order body and its headers. */
function expectProductionAccepts({ body, headers }: Sent) {
  const key = headers['x-idempotency-key'];
  if (key !== undefined) expect(key).toMatch(/^[\w-]+$/);

  expect(typeof body.reference_id).toBe('string');
  expect((body.reference_id as string).length).toBeLessThanOrEqual(64);

  const taxId = body.customer.tax_id;
  if (taxId !== undefined) {
    expect(taxId).toMatch(DIGITS);
    expect([11, 14]).toContain((taxId as string).length);
  }
  if (body.customer.email !== undefined) expect(body.customer.email).toMatch(/^[^@\s]+@[^@\s]+$/);

  for (const phone of body.customer.phones ?? []) {
    expect(phone.country).toBe('55');
    expect(phone.area).toMatch(/^\d{2}$/);
    expect(phone.number).toMatch(/^\d{8,9}$/);
    expect(PHONE_TYPES).toContain(phone.type);
    expect(phone.type).toBe((phone.number as string).length === 9 ? 'MOBILE' : 'HOME');
  }

  const charge = body.charges[0];
  expect(body.charges).toHaveLength(1);
  expect(Number.isInteger(charge?.amount.value)).toBe(true);
  expect(charge?.amount.value as number).toBeGreaterThan(0);
  expect(charge?.amount.currency).toBe('BRL');
  if (charge?.description !== undefined) expect((charge.description as string).length).toBeLessThanOrEqual(64);

  const itemsTotal = body.items.reduce(
    (sum, item) => sum + (item.quantity as number) * (item.unit_amount as number),
    0,
  );
  for (const item of body.items) {
    expect(Number.isInteger(item.quantity)).toBe(true);
    expect(Number.isInteger(item.unit_amount)).toBe(true);
    expect(item.unit_amount as number).toBeGreaterThan(0);
  }
  expect(itemsTotal).toBe(charge?.amount.value);

  for (const url of body.notification_urls ?? []) {
    expect(typeof url).toBe('string');
    expect((url as string).length).toBeLessThanOrEqual(150);
  }
}

const METHODS = ['pix', 'card'] as const;

/** Phones as a checkout form receives them: masked, bare, prefixed, landline, DDD 55. */
const PHONES = [
  '(11) 98888-7777',
  '11988887777',
  '11 98888 7777',
  '11 9 8888-7777',
  '+55 11 98888-7777',
  '+55 (11) 98888-7777',
  '5511988887777',
  '(21) 99876-5432',
  '(31) 3222-1100',
  '3132221100',
  '+55 31 3222-1100',
  '(55) 99999-8888',
  '55999998888',
  '+55 (55) 99999-8888',
  '(85) 3456-7890',
  '(61) 4002-8922',
  '(91) 98123-4567',
  '  (47) 99123-4567  ',
  '(11) 3003-3030',
];

/** Phones no PagBank entry can be built from: the order goes without `phones`, never with a partial one. */
const UNUSABLE_PHONES = ['', '   ', '12345', '055 11 98888-7777', '988887777', '+1 415 555 0100', '5511988887777123', 'não tenho'];

/** Holder documents with and without their mask. */
const TAX_IDS = [
  { input: '123.456.789-09', digits: '12345678909' },
  { input: '12345678909', digits: '12345678909' },
  { input: ' 529.982.247-25 ', digits: '52998224725' },
  { input: '11.222.333/0001-81', digits: '11222333000181' },
  { input: '11222333000181', digits: '11222333000181' },
  { input: '45.723.174/0001-10', digits: '45723174000110' },
];

/** References a real order produces: a uuid, a uuid with a retry suffix, a long one. */
const REFERENCES = [
  '7bb98833-8ea7-462f-a90c-4097ab0e036e',
  '143837c7-cbc3-4481-a33a-11518c2c2871--2',
  'order-1',
  'ORD_2026_10_27',
  'a'.repeat(64),
];

/** Attempt idempotency keys, as `${base}:${n}` builds them — the colon production refused. */
const IDEMPOTENCY_KEYS = [
  '7bb98833-8ea7-462f-a90c-4097ab0e036e:1',
  '7bb98833-8ea7-462f-a90c-4097ab0e036e:2',
  '143837c7-cbc3-4481-a33a-11518c2c2871--2:1',
  'order-1:10',
  'verify:tenant-1:pagbank:1',
  'a.b/c:d e',
];

/** Amounts from the R$ 1,00 floor to a large ticket. */
const AMOUNTS = [100, 101, 690, 1250, 5653, 9990, 123_456, 999_999];

describe('PagBank production contract — the buyer phone (40001)', () => {
  for (const method of METHODS) {
    it.each(PHONES)(`${method}: %j goes out typed and whole`, async (phone) => {
      const sent = await send(method, (input) => ({ ...input, customer: { ...input.customer, phone } }));
      expect(sent.body.customer.phones).toHaveLength(1);
      expectProductionAccepts(sent);
    });

    it.each(UNUSABLE_PHONES)(`${method}: %j sends no phones at all`, async (phone) => {
      const sent = await send(method, (input) => ({ ...input, customer: { ...input.customer, phone } }));
      expect(sent.body.customer.phones).toBeUndefined();
      expectProductionAccepts(sent);
    });
  }
});

describe('PagBank production contract — the holder document', () => {
  for (const method of METHODS) {
    it.each(TAX_IDS)(`${method}: $input goes out as $digits`, async ({ input: taxId, digits }) => {
      const sent = await send(method, (input) => ({ ...input, customer: { ...input.customer, taxId } }));
      expect(sent.body.customer.tax_id).toBe(digits);
      expectProductionAccepts(sent);
    });
  }
});

describe('PagBank production contract — the order reference', () => {
  for (const method of METHODS) {
    it.each(REFERENCES)(`${method}: %j is the order's reference`, async (reference) => {
      const sent = await send(method, (input) => ({ ...input, reference }));
      expect(sent.body.reference_id).toBe(reference);
      // PIX repeats it on the charge; the card order (homologated as is) does not.
      if (method === 'pix') expect(sent.body.charges[0]?.reference_id).toBe(reference);
      expectProductionAccepts(sent);
    });
  }
});

describe('PagBank production contract — the idempotency key (40002)', () => {
  for (const method of METHODS) {
    it.each(IDEMPOTENCY_KEYS)(`${method}: attempt key %j reaches PagBank as [\\w-]+`, async (idempotencyKey) => {
      const sent = await send(method, (input) => ({ ...input, idempotencyKey }));
      expect(sent.headers['x-idempotency-key']).toMatch(/^[\w-]+$/);
      expectProductionAccepts(sent);
    });
  }

  it('keeps two attempts of one order apart after the mapping', async () => {
    const first = await send('pix', (input) => ({ ...input, idempotencyKey: 'order-1:1' }));
    const second = await send('pix', (input) => ({ ...input, idempotencyKey: 'order-1:2' }));
    expect(first.headers['x-idempotency-key']).not.toBe(second.headers['x-idempotency-key']);
  });
});

describe('PagBank production contract — the amount', () => {
  for (const method of METHODS) {
    it.each(AMOUNTS)(`${method}: %i cents is charged and itemised exactly`, async (amountCents) => {
      const sent = await send(method, (input) => ({ ...input, amount: { amountCents, currency: 'BRL' } }));
      expect(sent.body.charges[0]?.amount.value).toBe(amountCents);
      expectProductionAccepts(sent);
    });
  }
});

describe('PagBank production contract — the checkout that failed over in production', () => {
  it.each(METHODS)('%s: the order that failed over in production now passes every rule', async (method) => {
    const sent = await send(method, (input) => ({
      ...input,
      reference: '7bb98833-8ea7-462f-a90c-4097ab0e036e',
      idempotencyKey: '7bb98833-8ea7-462f-a90c-4097ab0e036e:1',
      amount: { amountCents: 5653, currency: 'BRL' },
      customer: { name: 'Ana Buyer', email: 'comprador@example.com', taxId: '529.982.247-25', phone: '(31) 99449-4408' },
    }));
    expect(sent.body.customer.phones).toEqual([{ country: '55', area: '31', number: '994494408', type: 'MOBILE' }]);
    expect(sent.headers['x-idempotency-key']).toBe('7bb98833-8ea7-462f-a90c-4097ab0e036e_1');
    expectProductionAccepts(sent);
  });

  it('a PIX order carries an ISO expiration on its charge', async () => {
    const sent = await send('pix', (input) => input);
    const expiration = sent.body.charges[0]?.payment_method.pix?.expiration_date;
    expect(typeof expiration).toBe('string');
    expect(Number.isNaN(Date.parse(expiration as string))).toBe(false);
    expectProductionAccepts(sent);
  });
});
