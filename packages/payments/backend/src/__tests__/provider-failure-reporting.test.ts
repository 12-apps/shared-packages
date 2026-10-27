import { describe, expect, it, vi } from 'vitest';

import {
  AmbiguousChargeError,
  ChargeDeclinedError,
  NoProviderSucceededError,
  ProviderRequestError,
  UnsupportedOperationError,
} from '../core/errors';
import { createPaymentsGateway, type PaymentsGatewayConfig } from '../core/gateway';
import { reconcilePendingCharges } from '../core/payable-sweep';
import type { AttemptLedger } from '../core/ports';
import type { PaymentProviderAdapter } from '../core/provider';
import type { ProviderHealth } from '../core/provider-health';
import {
  type ProviderFailureReport,
  describeProviderFailure,
  redactProviderText,
  reportProviderFailure,
} from '../core/provider-failure';
import { defineProviders } from '../core/registry';
import type { ChargeInput, ChargeSnapshot } from '../core/types';
import {
  createMemoryAttemptLedger,
  createMemoryChargeStore,
  createMemoryCredentialStore,
  type MemoryAttemptLedger,
} from '../memory';
import { createMemoryWebhookInbox } from '../memory-webhook-inbox';
import { STUB_CREDS, TENANT, cardInput, pixInput } from './fixtures';

/**
 * FUT-4074 — every provider refusal or error reaches the host.
 *
 * Production: the head of a store's chain answered EVERY checkout with
 * `400 … 40001 customer.phones[0].type must not be null`, the walk failed over
 * and charged the next provider, and nothing — no tracker event, no
 * notification, no screen — said the head was refusing. These tests pin that
 * each non-success outcome is handed to the host, that the documented
 * silences stay silent, that a broken reporter can never break a charge, and
 * that nothing secret rides along.
 */

// ── a provider whose every call is scripted ────────────────────────────────

interface Script {
  charge?: (input: ChargeInput) => Promise<ChargeSnapshot>;
  probe?: () => Promise<ChargeSnapshot | null>;
  getCharge?: () => Promise<ChargeSnapshot>;
  cancelCharge?: () => Promise<ChargeSnapshot>;
  refund?: () => Promise<never>;
  vault?: PaymentProviderAdapter['vault'];
  methods?: ('PIX' | 'CARD' | 'BOLETO')[];
  customerSchema?: PaymentProviderAdapter['customerSchema'];
}

function snapshotOf(name: string, input: ChargeInput, over: Partial<ChargeSnapshot> = {}): ChargeSnapshot {
  return {
    provider: name,
    providerChargeId: `${name}_${input.reference}`,
    status: 'PENDING',
    amount: input.amount,
    method: input.method,
    ...over,
  };
}

function scripted(name: string, script: Script = {}): PaymentProviderAdapter {
  const adapter: PaymentProviderAdapter = {
    name,
    displayName: name,
    capabilities: {
      methods: script.methods ?? ['PIX', 'CARD', 'BOLETO'],
      savedCards: false,
      refunds: Boolean(script.refund),
      partialRefunds: false,
      splits: false,
      webhooks: true,
      tokenization: 'PUBLIC_KEY',
    },
    credentialSchema: [],
    ...(script.customerSchema ? { customerSchema: script.customerSchema } : {}),
    verifyCredentials: async () => ({ ok: true }),
    createCharge: async (input) => (script.charge ? script.charge(input) : snapshotOf(name, input)),
    getCharge: async (id) =>
      script.getCharge ? script.getCharge() : snapshotOf(name, pixInput(), { providerChargeId: id }),
    webhook: { verify: async () => true, parse: async () => [] },
    clientConfig: () => ({ provider: name, tokenization: 'PUBLIC_KEY' }),
  };
  if (script.probe) adapter.findChargeByReference = async () => script.probe!();
  if (script.cancelCharge) adapter.cancelCharge = async () => script.cancelCharge!();
  if (script.refund) adapter.refund = async () => script.refund!();
  return script.vault ? { ...adapter, vault: script.vault } : adapter;
}

/** The production rejection, as the PagBank adapter builds it. */
function pagbankPhoneRejection(): ProviderRequestError {
  const body = {
    error_messages: [
      { code: '40001', description: 'must not be null', parameter_name: 'customer.phones[0].type' },
    ],
  };
  return new ProviderRequestError('alpha', `alpha 400 Bad Request: ${JSON.stringify(body)}`, {
    httpStatus: 400,
    body,
    retriable: false,
    request: {
      method: 'POST',
      url: 'https://api.example/orders',
      headers: { authorization: 'Bearer [redacted]' },
      body: { customer: { email: 'ana@example.com', tax_id: '12345678909' } },
    },
  });
}

function preSendFailure(): Error {
  return Object.assign(new TypeError('fetch failed'), {
    cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
  });
}

function timeoutFailure(): Error {
  return Object.assign(new TypeError('fetch failed'), {
    cause: Object.assign(new Error('headers timeout'), { code: 'UND_ERR_HEADERS_TIMEOUT' }),
  });
}

interface WorldOptions {
  /** Providers in chain order; `connected: false` leaves one unconnected. */
  chain: { adapter: PaymentProviderAdapter; connected?: boolean }[];
  /** Names in the merchant's chain that no adapter is registered for. */
  ghosts?: string[];
  /** `null` builds the gateway with NO reporter at all. */
  reporter?: PaymentsGatewayConfig['onProviderFailure'] | null;
  health?: ProviderHealth;
  ledger?: AttemptLedger;
  policy?: 'TECHNICAL_AND_DECLINE';
}

function world(options: WorldOptions) {
  const reports: ProviderFailureReport[] = [];
  const credentials = createMemoryCredentialStore();
  const charges = createMemoryChargeStore();
  const attempts = options.ledger ?? createMemoryAttemptLedger();
  const registry: Record<string, PaymentProviderAdapter> = {};
  for (const { adapter } of options.chain) registry[adapter.name] = adapter;
  const gateway = createPaymentsGateway({
    providers: defineProviders(registry),
    credentials,
    charges,
    webhooks: createMemoryWebhookInbox(),
    attempts,
    ...(options.reporter === null
      ? {}
      : { onProviderFailure: options.reporter ?? ((report) => void reports.push(report)) }),
    ...(options.health ? { health: options.health } : {}),
    ...(options.policy ? { failoverPolicy: options.policy } : {}),
  });
  for (const { adapter, connected } of options.chain) {
    if (connected !== false) credentials.set(TENANT, adapter.name, STUB_CREDS);
  }
  credentials.setChain(TENANT, [...options.chain.map(({ adapter }) => adapter.name), ...(options.ghosts ?? [])]);
  return { gateway, charges, reports, attempts: attempts as MemoryAttemptLedger };
}

const refuse = (error: unknown) => async (): Promise<never> => {
  throw error;
};

// ── the charge walk ─────────────────────────────────────────────────────────

describe('the charge walk reports every non-success attempt', () => {
  it('reports the production case: the head refuses with a 400, the tail charges', async () => {
    const w = world({
      chain: [{ adapter: scripted('alpha', { charge: refuse(pagbankPhoneRejection()) }) }, { adapter: scripted('beta') }],
    });

    const charge = await w.gateway.charge(TENANT, pixInput('order-77'));

    expect(charge.provider).toBe('beta');
    expect(w.reports).toHaveLength(1);
    expect(w.reports[0]).toMatchObject({
      path: 'CHARGE',
      severity: 'error',
      merchant: TENANT,
      provider: 'alpha',
      reference: 'order-77',
      outcome: 'FAILED_OVER',
      failureBucket: 'DEFINITELY_NOT_CHARGED',
      probeResult: null,
      attemptNo: 1,
      httpStatus: 400,
      providerCodes: ['40001'],
      reasons: [{ code: '40001', description: 'must not be null', parameterName: 'customer.phones[0].type' }],
      errorName: 'ProviderRequestError',
      environment: 'SANDBOX',
      fingerprint: 'CHARGE:alpha:FAILED_OVER:400:40001',
    });
  });

  it('reports a pre-send network failure that failed over', async () => {
    const w = world({
      chain: [{ adapter: scripted('alpha', { charge: refuse(preSendFailure()) }) }, { adapter: scripted('beta') }],
    });
    await w.gateway.charge(TENANT, pixInput());
    expect(w.reports.map((r) => [r.provider, r.outcome, r.severity, r.httpStatus])).toEqual([
      ['alpha', 'FAILED_OVER', 'error', null],
    ]);
  });

  it('reports an ambiguous failure the probe proved safe, with its probe result', async () => {
    const w = world({
      chain: [
        { adapter: scripted('alpha', { charge: refuse(timeoutFailure()), probe: async () => null }) },
        { adapter: scripted('beta') },
      ],
    });
    await w.gateway.charge(TENANT, pixInput());
    expect(w.reports).toHaveLength(1);
    expect(w.reports[0]).toMatchObject({
      outcome: 'FAILED_OVER',
      failureBucket: 'AMBIGUOUS',
      probeResult: 'NOT_CHARGED',
      severity: 'error',
    });
  });

  it('reports a STOPPED walk as an error before the ambiguous charge is thrown', async () => {
    const w = world({
      chain: [{ adapter: scripted('alpha', { charge: refuse(timeoutFailure()) }) }, { adapter: scripted('beta') }],
    });
    await expect(w.gateway.charge(TENANT, pixInput())).rejects.toBeInstanceOf(AmbiguousChargeError);
    expect(w.reports).toHaveLength(1);
    expect(w.reports[0]).toMatchObject({
      outcome: 'STOPPED',
      failureBucket: 'AMBIGUOUS',
      probeResult: 'UNSUPPORTED',
      severity: 'error',
      errorName: 'TypeError',
    });
  });

  it('reports a charge ADOPTED after a lost answer as a warning', async () => {
    const input = pixInput('order-adopt');
    const w = world({
      chain: [
        {
          adapter: scripted('alpha', {
            charge: refuse(timeoutFailure()),
            probe: async () => snapshotOf('alpha', input),
          }),
        },
      ],
    });
    const charge = await w.gateway.charge(TENANT, input);
    expect(charge.provider).toBe('alpha');
    expect(w.reports.map((r) => [r.outcome, r.severity, r.probeResult])).toEqual([
      ['ADOPTED', 'warning', 'CHARGE_FOUND'],
    ]);
  });

  it('reports a decline returned as a snapshot at info level', async () => {
    const w = world({
      chain: [
        {
          adapter: scripted('alpha', {
            charge: async (input) => snapshotOf('alpha', input, { status: 'DECLINED', declineReason: 'INSUFFICIENT_FUNDS' }),
          }),
        },
      ],
    });
    const charge = await w.gateway.charge(TENANT, pixInput());
    expect(charge.snapshot.status).toBe('DECLINED');
    expect(w.reports.map((r) => [r.outcome, r.severity, r.message])).toEqual([
      ['DECLINED', 'info', 'INSUFFICIENT_FUNDS'],
    ]);
  });

  it('reports a decline thrown by the adapter at info level, before the typed decline is thrown', async () => {
    const w = world({
      chain: [{ adapter: scripted('alpha', { charge: refuse(new ChargeDeclinedError('alpha', 'FRAUD_SUSPECTED')) }) }],
    });
    await expect(w.gateway.charge(TENANT, pixInput())).rejects.toBeInstanceOf(ChargeDeclinedError);
    expect(w.reports.map((r) => [r.outcome, r.severity, r.errorName])).toEqual([
      ['DECLINED', 'info', 'ChargeDeclinedError'],
    ]);
  });

  it('reports a decline that cascades under TECHNICAL_AND_DECLINE', async () => {
    const w = world({
      policy: 'TECHNICAL_AND_DECLINE',
      chain: [
        { adapter: scripted('alpha', { charge: async (i) => snapshotOf('alpha', i, { status: 'DECLINED' }) }) },
        { adapter: scripted('beta') },
      ],
    });
    const charge = await w.gateway.charge(TENANT, pixInput());
    expect(charge.provider).toBe('beta');
    expect(w.reports.map((r) => [r.provider, r.outcome])).toEqual([['alpha', 'DECLINED']]);
  });

  it('reports a chain member that is not connected as a misconfiguration warning', async () => {
    const w = world({
      chain: [{ adapter: scripted('alpha'), connected: false }, { adapter: scripted('beta') }],
    });
    await w.gateway.charge(TENANT, pixInput());
    expect(w.reports.map((r) => [r.provider, r.outcome, r.severity, r.environment])).toEqual([
      ['alpha', 'SKIPPED', 'warning', null],
    ]);
  });

  it('reports a chain member no adapter is registered for', async () => {
    const exhausted = world({ chain: [], ghosts: ['ghost'] });
    await expect(exhausted.gateway.charge(TENANT, pixInput())).rejects.toBeInstanceOf(NoProviderSucceededError);
    expect(exhausted.reports.map((r) => [r.provider, r.outcome, r.severity])).toEqual([
      ['ghost', 'SKIPPED', 'warning'],
    ]);
  });

  it('reports every failure of an exhausted chain, one per provider', async () => {
    const w = world({
      chain: [
        { adapter: scripted('alpha', { charge: refuse(pagbankPhoneRejection()) }) },
        { adapter: scripted('beta', { charge: refuse(preSendFailure()) }) },
      ],
    });
    await expect(w.gateway.charge(TENANT, pixInput())).rejects.toBeInstanceOf(NoProviderSucceededError);
    expect(w.reports.map((r) => [r.provider, r.attemptNo])).toEqual([
      ['alpha', 1],
      ['beta', 2],
    ]);
  });

  it('reports nothing for a charge the head takes', async () => {
    const w = world({ chain: [{ adapter: scripted('alpha') }] });
    await w.gateway.charge(TENANT, pixInput());
    expect(w.reports).toEqual([]);
  });

  it('still reports when the ledger write fails', async () => {
    const ledger: AttemptLedger = {
      record: async () => {
        throw new Error('ledger down');
      },
      listByIdempotencyKey: async () => [],
    };
    const w = world({
      ledger,
      chain: [{ adapter: scripted('alpha', { charge: refuse(pagbankPhoneRejection()) }) }, { adapter: scripted('beta') }],
    });
    await w.gateway.charge(TENANT, pixInput());
    expect(w.reports.map((r) => r.outcome)).toEqual(['FAILED_OVER']);
  });
});

// ── the documented silences ────────────────────────────────────────────────

describe('the documented silences stay silent', () => {
  it('METHOD_NOT_OFFERED: a provider that cannot do the method is the chain working', async () => {
    const w = world({ chain: [{ adapter: scripted('alpha', { methods: ['CARD'] }) }, { adapter: scripted('beta') }] });
    await w.gateway.charge(TENANT, pixInput());
    expect(w.attempts.all().map((a) => a.outcome)).toEqual(['SKIPPED', 'SUCCEEDED']);
    expect(w.reports).toEqual([]);
  });

  it('NO_INSTRUMENT: no card token was minted for this provider', async () => {
    // The bare token belongs to the chain head; make the head refuse so the
    // walk reaches the tail, which has no instrument of its own.
    const failing = world({
      chain: [{ adapter: scripted('alpha', { charge: refuse(pagbankPhoneRejection()) }) }, { adapter: scripted('beta') }],
    });
    await expect(failing.gateway.charge(TENANT, cardInput())).rejects.toBeInstanceOf(NoProviderSucceededError);
    expect(failing.attempts.all().map((a) => [a.provider, a.outcome])).toEqual([
      ['alpha', 'FAILED_OVER'],
      ['beta', 'SKIPPED'],
    ]);
    expect(failing.reports.map((r) => r.provider)).toEqual(['alpha']);
  });

  it('BREAKER_OPEN: the failures that opened the breaker were the reports', async () => {
    const health: ProviderHealth = {
      isAvailable: async (provider) => provider !== 'alpha',
      recordSuccess: async () => undefined,
      recordFailure: async () => undefined,
    };
    const w = world({ health, chain: [{ adapter: scripted('alpha') }, { adapter: scripted('beta') }] });
    await w.gateway.charge(TENANT, pixInput());
    expect(w.attempts.all().map((a) => a.outcome)).toEqual(['SKIPPED', 'SUCCEEDED']);
    expect(w.reports).toEqual([]);
  });

  it('BUYER_FIELDS: the buyer is asked for the field on screen', async () => {
    const w = world({
      chain: [
        {
          adapter: scripted('alpha', {
            customerSchema: [{ key: 'phone', type: 'PHONE', required: true }],
          }),
        },
        { adapter: scripted('beta') },
      ],
    });
    await w.gateway.charge(TENANT, pixInput());
    expect(w.attempts.all().map((a) => a.outcome)).toEqual(['SKIPPED', 'SUCCEEDED']);
    expect(w.reports).toEqual([]);
  });

  it('RESOLVED_ON_RETRY: a retry whose re-probe settles the earlier stop', async () => {
    const probe = vi.fn<() => Promise<ChargeSnapshot | null>>();
    probe.mockRejectedValueOnce(new Error('probe down')).mockResolvedValue(null);
    const w = world({
      chain: [
        { adapter: scripted('alpha', { charge: refuse(timeoutFailure()), probe }) },
        { adapter: scripted('beta') },
      ],
    });
    const input = { ...pixInput('order-retry'), idempotencyKey: 'key-1' };
    await expect(w.gateway.charge(TENANT, input)).rejects.toBeInstanceOf(AmbiguousChargeError);
    expect(w.reports.map((r) => r.outcome)).toEqual(['STOPPED']);

    const charge = await w.gateway.charge(TENANT, input);

    expect(charge.provider).toBe('beta');
    // The re-probe's FAILED_OVER row exists, but the stop was already reported.
    expect(w.attempts.all().map((a) => a.outcome)).toEqual(['STOPPED', 'FAILED_OVER', 'SUCCEEDED']);
    expect(w.reports.map((r) => r.outcome)).toEqual(['STOPPED']);
  });
});

// ── a broken reporter never breaks a charge ────────────────────────────────

describe('a reporter that fails cannot break a charge', () => {
  it('a reporter that throws synchronously', async () => {
    const reporter = vi.fn(() => {
      throw new Error('tracker exploded');
    });
    const w = world({
      reporter,
      chain: [{ adapter: scripted('alpha', { charge: refuse(pagbankPhoneRejection()) }) }, { adapter: scripted('beta') }],
    });
    const charge = await w.gateway.charge(TENANT, pixInput());
    expect(charge.provider).toBe('beta');
    expect(reporter).toHaveBeenCalledTimes(1);
  });

  it('a reporter that rejects asynchronously (no unhandled rejection escapes)', async () => {
    const reporter = vi.fn(async () => {
      throw new Error('tracker offline');
    });
    const w = world({
      reporter,
      chain: [{ adapter: scripted('alpha', { charge: refuse(pagbankPhoneRejection()) }) }, { adapter: scripted('beta') }],
    });
    const charge = await w.gateway.charge(TENANT, pixInput());
    expect(charge.provider).toBe('beta');
    expect(reporter).toHaveBeenCalledTimes(1);
  });

  it('a reporter that never settles does not hold the charge open', async () => {
    const reporter = vi.fn(() => new Promise<void>(() => undefined));
    const w = world({
      reporter,
      chain: [{ adapter: scripted('alpha', { charge: refuse(pagbankPhoneRejection()) }) }, { adapter: scripted('beta') }],
    });
    await expect(w.gateway.charge(TENANT, pixInput())).resolves.toMatchObject({ provider: 'beta' });
  });

  it('the ambiguous stop still throws its own error, not the reporter\'s', async () => {
    const w = world({
      reporter: () => {
        throw new Error('tracker exploded');
      },
      chain: [{ adapter: scripted('alpha', { charge: refuse(timeoutFailure()) }) }],
    });
    await expect(w.gateway.charge(TENANT, pixInput())).rejects.toBeInstanceOf(AmbiguousChargeError);
  });
});

// ── the gateway's follow-up calls ──────────────────────────────────────────

describe("the gateway's follow-up provider calls report and rethrow", () => {
  it('refreshCharge: a provider failure is reported as a warning and rethrown untouched', async () => {
    const error = new ProviderRequestError('alpha', 'alpha 401 Unauthorized', { httpStatus: 401 });
    const w = world({ chain: [{ adapter: scripted('alpha', { getCharge: refuse(error) }) }] });
    await expect(w.gateway.refreshCharge(TENANT, 'alpha', 'ch_1')).rejects.toBe(error);
    expect(w.reports).toHaveLength(1);
    expect(w.reports[0]).toMatchObject({
      path: 'REFRESH',
      severity: 'warning',
      provider: 'alpha',
      reference: 'ch_1',
      httpStatus: 401,
      outcome: null,
      attemptNo: null,
    });
  });

  it('refreshCharge: "not connected" is a state, not a provider refusal', async () => {
    const w = world({ chain: [{ adapter: scripted('alpha'), connected: false }] });
    await expect(w.gateway.refreshCharge(TENANT, 'alpha', 'ch_1')).rejects.toThrow(/not connected/);
    expect(w.reports).toEqual([]);
  });

  it('refreshCharge: a transport failure is reported under the provider the call named', async () => {
    const w = world({ chain: [{ adapter: scripted('alpha', { getCharge: refuse(preSendFailure()) }) }] });
    await expect(w.gateway.refreshCharge(TENANT, 'alpha', 'ch_1')).rejects.toThrow('fetch failed');
    expect(w.reports.map((r) => [r.path, r.provider, r.errorName])).toEqual([['REFRESH', 'alpha', 'TypeError']]);
  });

  it('the pending-charge sweep, which swallows the error, no longer swallows the report', async () => {
    const w = world({
      chain: [
        {
          adapter: scripted('alpha', {
            getCharge: refuse(new ProviderRequestError('alpha', 'alpha 503', { httpStatus: 503 })),
          }),
        },
      ],
    });
    await w.gateway.charge(TENANT, pixInput('order-pending'));
    const report = await reconcilePendingCharges(
      { charges: w.charges, gateway: w.gateway, settle: async () => undefined },
      // The widest window there is, so the charge just created is in it.
      { now: new Date(8_640_000_000_000_000), graceMs: 0, abandonAfterMs: 8_640_000_000_000_000 },
    );
    expect(report).toMatchObject({ checked: 1, failed: 1 });
    expect(w.reports.map((r) => [r.path, r.httpStatus])).toEqual([['REFRESH', 503]]);
  });

  it('cancelCharge: a provider failure is an error; "cannot void" is not reported', async () => {
    const refusing = world({
      chain: [
        {
          adapter: scripted('alpha', {
            cancelCharge: refuse(new ProviderRequestError('alpha', 'alpha 422', { httpStatus: 422 })),
          }),
        },
      ],
    });
    await expect(refusing.gateway.cancelCharge(TENANT, 'alpha', 'ch_1')).rejects.toThrow('alpha 422');
    expect(refusing.reports.map((r) => [r.path, r.severity, r.httpStatus])).toEqual([['CANCEL', 'error', 422]]);

    const unable = world({ chain: [{ adapter: scripted('alpha') }] });
    await expect(unable.gateway.cancelCharge(TENANT, 'alpha', 'ch_1')).rejects.toBeInstanceOf(
      UnsupportedOperationError,
    );
    expect(unable.reports).toEqual([]);
  });

  it('refund: a provider failure is reported', async () => {
    const w = world({
      chain: [
        {
          adapter: scripted('alpha', {
            refund: refuse(new ProviderRequestError('alpha', 'alpha 400', { httpStatus: 400, providerCode: 'R1' })),
          }),
        },
      ],
    });
    await expect(w.gateway.refund(TENANT, 'alpha', { providerChargeId: 'ch_9' })).rejects.toThrow('alpha 400');
    expect(w.reports.map((r) => [r.path, r.reference, r.providerCodes])).toEqual([['REFUND', 'ch_9', ['R1']]]);
  });

  it('the vault: a provider failure while beginning is reported', async () => {
    const adapter = scripted('alpha', {
      vault: {
        begin: refuse(new ProviderRequestError('alpha', 'alpha 403', { httpStatus: 403 })),
        complete: refuse(new Error('unused')),
      },
    });
    const w = world({ chain: [{ adapter }] });
    await expect(
      w.gateway.beginVault(TENANT, { reference: 'vault-1', customerRef: 'cus-1' } as never),
    ).rejects.toThrow('alpha 403');
    expect(w.reports.map((r) => [r.path, r.provider, r.reference, r.httpStatus])).toEqual([
      ['VAULT', 'alpha', 'vault-1', 403],
    ]);
  });

  it('a gateway built without a reporter keeps its methods untouched', async () => {
    const w = world({ reporter: null, chain: [{ adapter: scripted('alpha', { getCharge: refuse(preSendFailure()) }) }] });
    await expect(w.gateway.refreshCharge(TENANT, 'alpha', 'ch_1')).rejects.toThrow('fetch failed');
    expect(w.reports).toEqual([]);
  });
});

// ── the report itself ──────────────────────────────────────────────────────

describe('describeProviderFailure', () => {
  it('never carries the request we sent, its headers or the buyer it named', () => {
    const report = describeProviderFailure({
      path: 'CHARGE',
      merchant: TENANT,
      provider: 'alpha',
      reference: 'order-1',
      error: pagbankPhoneRejection(),
    });
    const wire = JSON.stringify(report);
    expect(wire).not.toContain('ana@example.com');
    expect(wire).not.toContain('12345678909');
    expect(wire).not.toContain('api.example');
    expect(wire).not.toContain('authorization');
    expect(Object.keys(report).sort()).toEqual([
      'attemptNo',
      'environment',
      'errorName',
      'failureBucket',
      'fingerprint',
      'httpStatus',
      'merchant',
      'message',
      'outcome',
      'path',
      'probeResult',
      'provider',
      'providerCodes',
      'reasons',
      'reference',
      'severity',
    ]);
  });

  it('redacts what a provider echoes back in its message and reasons', () => {
    const body = {
      error_messages: [{ code: 'X', description: 'card 4111 1111 1111 1111 refused for ana@example.com' }],
    };
    const error = new ProviderRequestError(
      'alpha',
      'alpha 400: {"access_token":"sk_live_abc","card_number":"4111111111111111","cvv":123} ' +
        'Bearer abc.def-ghi cpf 123.456.789-09 email ana@example.com code 40001',
      { httpStatus: 400, body },
    );
    const report = describeProviderFailure({ path: 'CHARGE', merchant: TENANT, provider: 'alpha', error });
    const wire = JSON.stringify(report);
    for (const secret of ['sk_live_abc', '4111', 'abc.def-ghi', '123.456.789-09', 'ana@example.com', '"cvv":123']) {
      expect(wire).not.toContain(secret);
    }
    // The provider's code survives: it is what makes the report actionable.
    expect(report.message).toContain('code 40001');
    expect(report.reasons[0]?.description).toBe('card [redacted-number] refused for [redacted-email]');
  });

  it('caps the message', () => {
    const report = describeProviderFailure({
      path: 'CHARGE',
      merchant: TENANT,
      provider: 'alpha',
      error: new Error('x'.repeat(5_000)),
    });
    expect(report.message.length).toBeLessThanOrEqual(500);
  });

  it('copies the merchant rather than holding the caller\'s object', () => {
    const merchant = { kind: 'TENANT' as const, id: 't-1', extra: 'not ours' };
    const report = describeProviderFailure({ path: 'CHARGE', merchant, provider: 'alpha' });
    expect(report.merchant).toEqual({ kind: 'TENANT', id: 't-1' });
  });

  it('uses the ledger message when there is no error, and defaults severity by outcome', () => {
    const at = (outcome: 'STOPPED' | 'SKIPPED' | 'DECLINED' | 'ADOPTED' | 'FAILED_OVER') =>
      describeProviderFailure({ path: 'CHARGE', merchant: TENANT, provider: 'p', outcome, message: 'why' });
    expect(at('STOPPED')).toMatchObject({ severity: 'error', message: 'why', errorName: null });
    expect(at('FAILED_OVER').severity).toBe('error');
    expect(at('SKIPPED').severity).toBe('warning');
    expect(at('ADOPTED').severity).toBe('warning');
    expect(at('DECLINED').severity).toBe('info');
    expect(describeProviderFailure({ path: 'REFUND', merchant: TENANT, provider: 'p' }).severity).toBe('error');
  });

  it('groups by path, provider, outcome, status and codes — never by reference', () => {
    const of = (reference: string) =>
      describeProviderFailure({
        path: 'CHARGE',
        merchant: TENANT,
        provider: 'alpha',
        reference,
        outcome: 'FAILED_OVER',
        error: pagbankPhoneRejection(),
      }).fingerprint;
    expect(of('order-1')).toBe(of('order-2'));
    expect(describeProviderFailure({ path: 'REFRESH', merchant: TENANT, provider: 'a' }).fingerprint).toBe(
      'REFRESH:a:-:-:-',
    );
  });
});

describe('redactProviderText', () => {
  it('leaves a provider code, a field name and an HTTP status alone', () => {
    const text = 'PagBank 400 Bad Request: 40001 customer.phones[0].type must not be null';
    expect(redactProviderText(text)).toBe(text);
  });
});

describe('reportProviderFailure', () => {
  it('does nothing without a reporter', () => {
    expect(() => reportProviderFailure(undefined, { path: 'CHARGE', merchant: TENANT, provider: 'p' })).not.toThrow();
  });
});
