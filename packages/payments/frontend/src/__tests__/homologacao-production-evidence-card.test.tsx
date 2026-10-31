// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BrowserCardResult, EvidenceBuyer } from '@12-apps/payments-backend';

import {
  HomologacaoProductionEvidenceCard,
  type HomologacaoProductionSellerView,
} from '../components/platform/HomologacaoProductionEvidenceCard';
import { buyerOf, cardOf, EMPTY_BUYER, rememberedBuyer } from '../components/platform/production-evidence-data';
import type { ProductionPixView } from '../components/platform/ProductionPixPanel';
import { PT_BR_PLATFORM_HOMOLOGACAO_COPY } from '../components/platform/pt-BR';

/**
 * The PRODUCTION homologação evidence card (FUT-4198, option A+C). Pinned:
 * nothing is charged until the cardholder and a credit card are valid AND
 * "confirmar" is typed; only encrypted blobs reach the host; the Pix QR is
 * shown and checked until the server says it is settled; a skip is the
 * server's answer too; and a reloaded screen picks up an open Pix.
 *
 * jest-dom is not a dependency here, so DOM properties are asserted directly.
 */

const COPY = PT_BR_PLATFORM_HOMOLOGACAO_COPY;
const PROD = COPY.productionEvidence;

const SELLER: HomologacaoProductionSellerView = {
  connected: true,
  environment: 'PRODUCTION',
  status: 'VERIFIED',
  connectedAt: '2026-10-30T17:02:00Z',
  accountId: 'ACCO_PROD',
  pix: null,
};

const AWAITING: ProductionPixView = { runId: 'run-1', state: 'AWAITING_PAYMENT', qrText: '00020101pix', expiresAt: null };

beforeEach(() => {
  window.localStorage.clear();
  (window as { PagSeguro?: unknown }).PagSeguro = {
    encryptCard: vi.fn((params: { number: string }) => ({ hasErrors: false, encryptedCard: `enc-${params.number.slice(-4)}` })),
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (window as { PagSeguro?: unknown }).PagSeguro;
});

function mount(overrides: Partial<Parameters<typeof HomologacaoProductionEvidenceCard>[0]> = {}) {
  const sent: { cards: BrowserCardResult[]; buyer: EvidenceBuyer }[] = [];
  const props = {
    copy: COPY,
    seller: SELLER,
    onConnect: vi.fn(async () => undefined),
    onPrepare: vi.fn(async () => ({ runId: 'run-1', publicKey: 'PUBKEY' })),
    onRun: vi.fn(async (_runId: string, cards: BrowserCardResult[], _w: unknown, _s: unknown, buyer: EvidenceBuyer) => {
      sent.push({ cards, buyer });
      return AWAITING;
    }),
    onConfirmPix: vi.fn(async (): Promise<ProductionPixView> => ({ ...AWAITING, state: 'REFUNDED', qrText: null })),
    onDownload: vi.fn(async () => ({ executed: 20, failed: 0, pending: 2 })),
    pixPollMs: 10,
    ...overrides,
  };
  render(<HomologacaoProductionEvidenceCard {...props} />);
  return { props, sent };
}

const type = (testId: string, value: string): void => {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
};

function fillBuyer(): void {
  type('production-buyer-name', 'Thompson Moreira Filgueiras');
  type('production-buyer-taxId', '46.556.477/0001-59');
  type('production-buyer-email', 'thom@paladira.com');
  type('production-buyer-phone', '(31) 99449-4408');
  type('production-buyer-postalCode', '31610-000');
  type('production-buyer-street', 'Rua Padre Pedro Pinto');
  type('production-buyer-number', '424');
  type('production-buyer-complement', 'sala 601');
  type('production-buyer-city', 'Belo Horizonte');
  type('production-buyer-regionCode', 'mg');
}

function fillCredit(): void {
  type('production-credit-number', '4111 1111 1111 1111');
  type('production-credit-expiry', '12/30');
  type('production-credit-securityCode', '123');
}

const charge = () => screen.getByTestId('production-charge') as HTMLButtonElement;

function confirm(): void {
  fireEvent.click(charge());
  type('production-confirm-input', 'confirmar');
  fireEvent.click(screen.getByTestId('production-confirm-submit'));
}

describe('HomologacaoProductionEvidenceCard', () => {
  it('given an empty form, then nothing can be charged and the card says what is missing', () => {
    mount();

    expect(charge().disabled).toBe(true);
    expect(screen.getByTestId('production-incomplete-data').textContent).toBe(PROD.incompleteData);
  });

  it('given the cardholder and a credit card, when "confirmar" is typed, then only the encrypted card and the clean buyer reach the host', async () => {
    const { props, sent } = mount();
    fillBuyer();
    fillCredit();
    expect(charge().disabled).toBe(false);

    confirm();

    await waitFor(() => expect(props.onRun).toHaveBeenCalledTimes(1));
    expect(props.onPrepare).toHaveBeenCalledWith(
      expect.objectContaining({ taxId: '46556477000159', phone: '+5531994494408', billingAddress: expect.objectContaining({ regionCode: 'MG' }) }),
    );
    expect(sent[0]?.cards).toEqual([
      { scenario: 'approved', brand: 'VISA', masked: '**** **** **** 1111', encrypted: 'enc-1111' },
    ]);
    expect(JSON.stringify(sent)).not.toContain('4111111111111111');
  });

  it('given the confirmation, then it cannot be submitted until "confirmar" is typed', async () => {
    const { props } = mount();
    fillBuyer();
    fillCredit();
    fireEvent.click(charge());

    type('production-confirm-input', 'confirma');

    await waitFor(() => expect((screen.getByTestId('production-confirm-submit') as HTMLButtonElement).disabled).toBe(true));
    expect(props.onPrepare).not.toHaveBeenCalled();
  });

  it('given the run raised a Pix, then its QR is shown, checked until refunded, and the card fields are cleared', async () => {
    const { props } = mount();
    fillBuyer();
    fillCredit();
    confirm();

    await waitFor(() => expect(screen.getByTestId('production-pix-qr')).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId('production-pix-done').textContent).toBe(PROD.pix.paid));
    expect(props.onConfirmPix).toHaveBeenCalledWith('run-1', 'CHECK');
    expect((screen.getByTestId('production-credit-number') as HTMLInputElement).value).toBe('');
  });

  it('given the operator skips the Pix, then the server is told and its answer is shown', async () => {
    const onConfirmPix = vi.fn(async (_runId: string, action: 'CHECK' | 'SKIP'): Promise<ProductionPixView> =>
      action === 'SKIP' ? { ...AWAITING, state: 'SKIPPED', qrText: null } : AWAITING,
    );
    mount({ seller: { ...SELLER, pix: AWAITING }, onConfirmPix, pixPollMs: 60_000 });

    fireEvent.click(screen.getByTestId('production-pix-skip'));

    await waitFor(() => expect(screen.getByTestId('production-pix-done').textContent).toBe(PROD.pix.skipped));
    expect(onConfirmPix).toHaveBeenCalledWith('run-1', 'SKIP');
  });

  it('given an open Pix when the screen opens, then its QR is shown again and no new charge can start', () => {
    mount({ seller: { ...SELLER, pix: AWAITING }, pixPollMs: 60_000 });
    fillBuyer();
    fillCredit();

    expect(screen.getByTestId('production-pix-qr')).toBeTruthy();
    expect(charge().disabled).toBe(true);
  });

  it('given a debit card but no 3DS session, then it is sent with why instead of being charged', async () => {
    const { sent } = mount();
    fillBuyer();
    fillCredit();
    type('production-debit-number', '5555 6666 7777 8884');
    type('production-debit-expiry', '01/31');
    type('production-debit-securityCode', '321');

    confirm();

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.cards[1]).toMatchObject({ scenario: 'debit', brand: 'MASTERCARD', failure: 'NO_THREEDS_SESSION' });
  });

  it('given the step 4 download, then the counts the server answered are shown', async () => {
    const { props } = mount();

    fireEvent.click(screen.getByTestId('production-download'));

    await waitFor(() => expect(props.onDownload).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('evidence-summary-counts').textContent).toContain('20'));
  });
});

describe('production evidence data', () => {
  it('given a CPF or CNPJ, then only their digits go; anything else is not a buyer yet', () => {
    const base = {
      ...EMPTY_BUYER,
      name: 'Ana',
      email: 'ana@x.test',
      phone: '31999990000',
      postalCode: '30000-000',
      street: 'Rua A',
      number: '1',
      city: 'BH',
      regionCode: 'MG',
    };
    expect(buyerOf({ ...base, taxId: '123.456.789-09' })?.taxId).toBe('12345678909');
    expect(buyerOf({ ...base, taxId: '123' })).toBeNull();
    expect(buyerOf({ ...base, taxId: '12345678909', email: 'ana' })).toBeNull();
  });

  it('given an expiry, then a month out of range or a short CVV is not a card', () => {
    expect(cardOf({ number: '4111111111111111', expiry: '13/30', securityCode: '123' })).toBeNull();
    expect(cardOf({ number: '4111111111111111', expiry: '12/30', securityCode: '12' })).toBeNull();
    expect(cardOf({ number: '4111111111111111', expiry: '12/2030', securityCode: '123' })).toMatchObject({ expYear: '2030' });
  });

  it('given a cardholder from an earlier run, then the form starts with them; a broken record starts empty', () => {
    window.localStorage.setItem('payments.homologacao.production.buyer', JSON.stringify({ name: 'Ana', number: 7 }));
    expect(rememberedBuyer()).toMatchObject({ name: 'Ana', number: '7', city: '' });

    window.localStorage.setItem('payments.homologacao.production.buyer', '{oops');
    expect(rememberedBuyer()).toEqual(EMPTY_BUYER);
  });
});
