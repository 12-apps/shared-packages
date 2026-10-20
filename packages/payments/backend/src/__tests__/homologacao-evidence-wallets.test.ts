import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildHomologacaoEvidenceFile,
  buildHomologacaoEvidenceJson,
  completeEvidenceRun,
  prepareEvidenceRun,
  type BrowserWalletResult,
} from '../platform/evidence/index';
import { cards, connected, SECRETS, wallets, world } from './homologacao-evidence-world';

/**
 * FUT-3755 — the GOOGLE PAY and APPLE PAY sections: a wallet token the
 * browser got from the wallet's own sheet, charged as a card order with
 * `card.wallet { type, key }` through the host's gateway, consulted and
 * canceled. Numbered 6.x and 7.x, after debit, so every step PagBank already
 * cites keeps its number. Pinned:
 *
 *  - the token reaches PagBank verbatim and is ***REDACTED*** everywhere it is recorded;
 *  - no button pressed, a failed sheet, or no Apple Pay identity: every step
 *    of that section is PENDING with why, and nothing is charged;
 *  - phase 1 tells the browser how to open each sheet.
 */

type JsonScenario = {
  number: string;
  key: string;
  status: string;
  observed: string;
  notes: string[];
  ids: Record<string, string>;
  calls: Array<{ request: { method: string; url: string; body: unknown } }>;
};

async function scenarios(w: ReturnType<typeof world>): Promise<JsonScenario[]> {
  return (JSON.parse((await buildHomologacaoEvidenceJson(w.fileDeps)).content) as { scenarios: JsonScenario[] }).scenarios;
}

const of = (all: JsonScenario[], prefix: string) => all.filter((scenario) => scenario.key.startsWith(`${prefix}.`));

/** The wallet orders PagBank was sent, by wallet type. */
const walletOrders = (w: ReturnType<typeof world>, type: string) =>
  w.pagbank.seen.filter((call) => {
    const charges = call.body?.['charges'] as { payment_method?: { card?: { wallet?: { type?: string } } } }[] | undefined;
    return call.path === 'POST /orders' && charges?.[0]?.payment_method?.card?.wallet?.type === type;
  });

async function run(w: ReturnType<typeof world>, results?: BrowserWalletResult[]) {
  await connected(w);
  const prepared = await prepareEvidenceRun(w.runDeps);
  await completeEvidenceRun(w.runDeps, prepared.runId, cards(), results);
  return prepared;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('homologação evidence — the wallet sections', () => {
  it('given both tokens and an Apple Pay identity, then each wallet order is raised with card.wallet, consulted and canceled', async () => {
    const w = world({ applePayConfigured: true });

    await run(w, wallets());

    const all = await scenarios(w);
    expect(of(all, 'gpay').map((scenario) => [scenario.number, scenario.key, scenario.status])).toEqual([
      ['6.1', 'gpay.token', 'EXECUTED'],
      ['6.2', 'gpay.approved', 'EXECUTED'],
      ['6.3', 'gpay.consult', 'EXECUTED'],
      ['6.4', 'gpay.cancel', 'EXECUTED'],
    ]);
    expect(of(all, 'apay').map((scenario) => [scenario.number, scenario.status])).toEqual([
      ['7.1', 'EXECUTED'],
      ['7.2', 'EXECUTED'],
      ['7.3', 'EXECUTED'],
      ['7.4', 'EXECUTED'],
    ]);
    // The token went to PagBank verbatim, as the card's wallet, for the fixed amount…
    expect(walletOrders(w, 'GOOGLE_PAY')[0]?.body).toMatchObject({
      reference_id: 'homolog-00000000-gpay',
      charges: [
        {
          amount: { value: 1200 },
          payment_method: { type: 'CREDIT_CARD', capture: true, card: { wallet: { type: 'GOOGLE_PAY', key: 'gpay-token-secret' } } },
        },
      ],
    });
    expect(walletOrders(w, 'APPLE_PAY')[0]?.body).toMatchObject({ reference_id: 'homolog-00000000-apay' });
    expect(walletOrders(w, 'APPLE_PAY')[0]?.authorization).toBe('Bearer seller-access-2');
    // …and the recording carries it redacted, beside its type.
    const approved = all.find((scenario) => scenario.key === 'gpay.approved')!;
    expect(approved.calls[0]?.request.body).toMatchObject({
      charges: [{ payment_method: { card: { wallet: { type: 'GOOGLE_PAY', key: '***REDACTED***' } } } }],
    });
    expect(approved.ids).toMatchObject({ order_id: 'ORDE_G1', charge_id: 'CHAR_GP', reference_id: 'homolog-00000000-gpay' });
    const token = all.find((scenario) => scenario.key === 'gpay.token')!;
    expect(token.notes).toEqual(['card.wallet.type=GOOGLE_PAY · VISA **** 1111 · card.wallet.key=***REDACTED***']);
    expect(token.calls).toEqual([]);
    expect(token.observed).toContain('Token do Google Pay recebido no navegador (VISA **** 1111)');
    // The usage proof still holds with the wallet orders in it.
    expect(all.find((scenario) => scenario.key === 'connect.usage')?.status).toBe('EXECUTED');
  });

  it('given a full run, then the TXT and the JSON carry no wallet token and the TXT prints both sections after debit', async () => {
    const w = world({ applePayConfigured: true });

    await run(w, wallets());

    const txt = await buildHomologacaoEvidenceFile(w.fileDeps);
    const json = await buildHomologacaoEvidenceJson(w.fileDeps);
    for (const secret of SECRETS) {
      expect(txt.content).not.toContain(secret);
      expect(json.content).not.toContain(secret);
    }
    expect(txt.content).toContain('6. Google Pay (carteira digital)');
    expect(txt.content).toContain('7. Apple Pay (carteira digital)');
    expect(txt.content).toContain('8. Pendências');
    expect(txt.content).toMatch(/\[6\.2\] Pedido com Google Pay aprovado \(card\.wallet GOOGLE_PAY\)[^\n]*— EXECUTADO/);
    expect(txt.content).toContain('"key": "***REDACTED***"');
    // Every number PagBank already cites is where it was.
    const numbers = Object.fromEntries((await scenarios(w)).map((scenario) => [scenario.key, scenario.number]));
    expect(numbers).toMatchObject({ 'card.cancel': '4.6', 'debit.cancel': '5.5' });
  });

  it('given no wallet button was pressed, then every wallet step is PENDING with why and no wallet order is raised', async () => {
    const w = world({ applePayConfigured: true });

    await run(w);

    expect(walletOrders(w, 'GOOGLE_PAY')).toHaveLength(0);
    expect(walletOrders(w, 'APPLE_PAY')).toHaveLength(0);
    const all = await scenarios(w);
    for (const scenario of of(all, 'gpay')) {
      expect(scenario).toMatchObject({
        status: 'PENDING',
        calls: [],
        observed: 'Não executado: o botão do Google Pay não foi acionado antes de gerar o arquivo; nenhum pedido Google Pay foi criado.',
      });
    }
    expect(of(all, 'apay').map((scenario) => scenario.status)).toEqual(['PENDING', 'PENDING', 'PENDING', 'PENDING']);
    expect(of(all, 'apay')[0]?.observed).toContain('o botão do Apple Pay não foi acionado');
  });

  it('given no Apple Pay identity, then Apple Pay is PENDING waiting for the Apple Developer account, even with a token', async () => {
    const w = world();

    await run(w, wallets());

    expect(walletOrders(w, 'APPLE_PAY')).toHaveLength(0);
    const all = await scenarios(w);
    for (const scenario of of(all, 'apay')) {
      expect(scenario.status).toBe('PENDING');
      expect(scenario.observed).toBe(
        'Pendente: aguardando a conta Apple Developer — identidade Apple Pay não configurada (Merchant ID e certificado). ' +
          'Nenhum pedido Apple Pay foi criado.',
      );
    }
    // Google Pay does not wait on Apple's identity.
    expect(of(all, 'gpay').every((scenario) => scenario.status === 'EXECUTED')).toBe(true);
  });

  it('given the browser reports why there is no token, then each section says it in the copy and nothing is charged', async () => {
    const w = world({ applePayConfigured: true });

    await run(w, [
      { type: 'GOOGLE_PAY', token: null, brand: null, last4: null, failure: 'NOT_AVAILABLE' },
      { type: 'APPLE_PAY', token: null, brand: null, last4: null, failure: 'MERCHANT_VALIDATION_FAILED' },
    ]);

    expect(walletOrders(w, 'GOOGLE_PAY')).toHaveLength(0);
    const all = await scenarios(w);
    expect(of(all, 'gpay').map((scenario) => scenario.observed)).toEqual(
      Array(4).fill(
        'Token do Google Pay não obtido no navegador: a carteira não é oferecida neste navegador/dispositivo; nenhum pedido Google Pay foi criado.',
      ),
    );
    expect(of(all, 'apay')[3]?.observed).toBe(
      'Token do Apple Pay não obtido no navegador: a validação do comerciante Apple Pay não foi concluída; nenhum pedido Apple Pay foi criado.',
    );
  });

  it('given the operator closed the sheet, then the section says the sheet was closed', async () => {
    const w = world();

    await run(w, [{ type: 'GOOGLE_PAY', token: null, brand: null, last4: null, failure: 'DISMISSED' }]);

    expect((await scenarios(w)).find((scenario) => scenario.key === 'gpay.approved')).toMatchObject({
      status: 'PENDING',
      observed: 'Token do Google Pay não obtido no navegador: a folha de pagamento foi fechada pelo operador; nenhum pedido Google Pay foi criado.',
    });
  });

  it("given a connected sandbox seller, then phase 1 hands the browser Google Pay's TEST config against its account and the Apple Pay state", async () => {
    const configured = await run(world({ applePayConfigured: true }), wallets());
    const unconfigured = await run(world(), wallets());

    expect(configured.wallets).toEqual({
      amountCents: 1200,
      googlePay: { gateway: 'pagbank', gatewayMerchantId: 'ACCO_TEST', environment: 'TEST' },
      applePay: { configured: true },
    });
    expect(unconfigured.wallets.applePay).toEqual({ configured: false });
  });

  it('given a seller that is not a sandbox one, then phase 1 offers no Google Pay sheet and no wallet order is raised', async () => {
    const w = world({ sellerEnvironment: 'PRODUCTION' });

    const prepared = await run(w, wallets());

    expect(prepared.wallets.googlePay).toBeNull();
    expect(walletOrders(w, 'GOOGLE_PAY')).toHaveLength(0);
  });
});
