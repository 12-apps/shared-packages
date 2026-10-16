import { describe, expect, it } from 'vitest';

import { createPaymentsGateway } from '../core/gateway';
import { defineProviders } from '../core/registry';
import {
  createMemoryAttemptLedger,
  createMemoryChargeStore,
  createMemoryCredentialStore,
} from '../memory';
import { createMemoryWebhookInbox } from '../memory-webhook-inbox';
import { pagbankProvider } from '../providers/pagbank';
import { crc16Ccitt } from '../providers/pix-manual/br-code';
import { PT_BR_PAGBANK_COPY, PT_BR_STONE_COPY } from '../providers/pt-BR';
import { stoneProvider } from '../providers/stone';
import { STUB_CHARGE_FAULT_FIELD, isStubDeclinedToken } from '../providers/stub-fault';
import { STUB_CREDS, TENANT, cardInput, pixInput } from './fixtures';

/**
 * The stub conventions a REAL host meets (FUT-3627).
 *
 * The packaged journeys (`@12-apps/payments-e2e`) only passed in the harness,
 * whose in-page adapters papered over three disagreements between the shipped
 * checkout and this package's stub. A real host runs the real stub, so each
 * one is pinned here against the real adapters.
 */

/** The mock tokenizer's spelling of the shared decline PAN (`card/tokenize.ts`). */
const CHECKOUT_DECLINE_TOKEN = 'tok_declined_lx2k9a1';

describe('the stub decline marker', () => {
  it('given the checkout mock token for the decline PAN, when it is charged, then the stub declines it', async () => {
    const snapshot = await stoneProvider(PT_BR_STONE_COPY).createCharge(
      cardInput('order-decline', CHECKOUT_DECLINE_TOKEN),
      STUB_CREDS,
    );

    expect(snapshot.status).toBe('DECLINED');
    expect(snapshot.declineReason).toBe('CARD_DECLINED');
  });

  it('given an ordinary mock token, when it is charged, then the stub settles it', async () => {
    const snapshot = await stoneProvider(PT_BR_STONE_COPY).createCharge(
      cardInput('order-ok', 'tok_lx2k9a2'),
      STUB_CREDS,
    );

    expect(snapshot.status).toBe('PAID');
  });

  it('given the checkout mock token, when the stub vault validates it, then the card is refused', async () => {
    const vault = pagbankProvider(PT_BR_PAGBANK_COPY).vault;

    await expect(
      vault!.complete({ reference: 'sub-decline', token: CHECKOUT_DECLINE_TOKEN }, STUB_CREDS),
    ).rejects.toMatchObject({ name: 'ProviderRequestError', retriable: false });
  });

  it('reads both spellings and nothing else', () => {
    expect(isStubDeclinedToken('tok-declined')).toBe(true);
    expect(isStubDeclinedToken(CHECKOUT_DECLINE_TOKEN)).toBe(true);
    expect(isStubDeclinedToken('tok_lx2k9a2')).toBe(false);
    expect(isStubDeclinedToken('tok_ok-declined-twice')).toBe(false);
    expect(isStubDeclinedToken(undefined)).toBe(false);
  });
});

describe('the stub PIX code', () => {
  it('given a stub PIX charge, then the copia-e-cola is a well-formed static BR Code', async () => {
    const snapshot = await stoneProvider(PT_BR_STONE_COPY).createCharge(
      pixInput('order-pix'),
      STUB_CREDS,
    );
    const code = snapshot.pix?.qrText ?? '';

    expect(code.startsWith('000201')).toBe(true);
    expect(code.toLowerCase()).toContain('br.gov.bcb.pix');
    // Tag 54 carries the amount the buyer owes: pixInput is R$ 12,50.
    expect(code).toContain('540512.50');
    // The reference travels as the txid (tag 62/05): its readable part, then a
    // hash of the whole reference, 25 characters in all.
    expect(code).toMatch(/62290525orderpix[0-9a-f]{17}/);
    // The CRC covers everything up to and including its own `6304` header.
    expect(code.slice(-4)).toBe(crc16Ccitt(code.slice(0, -4)));
    // Still recognisably a stub, and never a key any bank resolves.
    expect(code).toContain('stub-pix@example.invalid');
  });
});

/**
 * A two-PagBank-stub chain, the HEAD scripted through its stub credentials —
 * exactly the lever a host's e2e fixture pulls. Real adapters, real walk, real
 * probe; only the far end is the stub.
 */
function scriptedPagbankChain(fault: string) {
  const credentials = createMemoryCredentialStore();
  const attempts = createMemoryAttemptLedger();
  const gateway = createPaymentsGateway({
    providers: defineProviders({
      pagbank: pagbankProvider(PT_BR_PAGBANK_COPY),
      stone: stoneProvider(PT_BR_STONE_COPY),
    }),
    credentials,
    charges: createMemoryChargeStore(),
    webhooks: createMemoryWebhookInbox(),
    attempts,
  });
  credentials.set(TENANT, 'pagbank', { ...STUB_CREDS, fields: { [STUB_CHARGE_FAULT_FIELD]: fault } });
  credentials.set(TENANT, 'stone', STUB_CREDS);
  return { gateway, attempts };
}

describe('the `unresolved` stub fault', () => {
  it('given a head whose charge AND probe get no answer, when the buyer pays, then the walk stops unresolved', async () => {
    const { gateway, attempts } = scriptedPagbankChain('unresolved');

    await expect(gateway.charge(TENANT, pixInput('order-unresolved'))).rejects.toMatchObject({
      name: 'AmbiguousChargeError',
    });
    // Nobody can prove the money did not move, so nobody else is asked.
    expect(attempts.all().map((attempt) => attempt.provider)).not.toContain('stone');
  });

  it('given `ambiguous`, when the stub probe answers "no such charge", then the walk still advances', async () => {
    const { gateway } = scriptedPagbankChain('ambiguous');

    const stored = await gateway.charge(TENANT, pixInput('order-ambiguous'));

    expect(stored.snapshot.provider).toBe('stone');
  });

  it('given no fault, then the stub probe answers "no such charge"', async () => {
    const adapter = pagbankProvider(PT_BR_PAGBANK_COPY);

    await expect(adapter.findChargeByReference!('order-none', STUB_CREDS)).resolves.toBeNull();
  });
});
