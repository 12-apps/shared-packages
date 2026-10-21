// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BrowserCardResult } from '@12-apps/payments-backend';

import { HomologacaoEvidenceCard, type HomologacaoSellerView } from '../components/platform/HomologacaoEvidenceCard';
import { PT_BR_PLATFORM_HOMOLOGACAO_COPY } from '../components/platform/pt-BR';

/**
 * The homologação evidence card (FUT-3696). Pinned: the card runs prepare →
 * browser encryption → run → download in that order, sends only encrypted
 * blobs (never a PAN), records WHY when the SDK is unavailable instead of
 * skipping the cards, and shows the server's counts rather than its own.
 *
 * jest-dom is not a dependency here, so DOM properties are asserted directly.
 */

const SELLER: HomologacaoSellerView = {
  connected: true,
  environment: 'SANDBOX',
  status: 'VERIFIED',
  connectedAt: '2026-10-17T15:00:00Z',
  accountId: 'ACCO_TEST',
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (window as { PagSeguro?: unknown }).PagSeguro;
});

function mount(overrides: Partial<Parameters<typeof HomologacaoEvidenceCard>[0]> = {}) {
  const ran: BrowserCardResult[][] = [];
  const props = {
    copy: PT_BR_PLATFORM_HOMOLOGACAO_COPY,
    seller: SELLER,
    onConnect: vi.fn(async () => undefined),
    onPrepare: vi.fn(async () => ({ runId: 'run-1', publicKey: 'PUBKEY' })),
    onRun: vi.fn(async (_runId: string, cards: BrowserCardResult[]) => {
      ran.push(cards);
    }),
    onDownload: vi.fn(async () => ({ executed: 15, failed: 0, pending: 2 })),
    ...overrides,
  };
  render(<HomologacaoEvidenceCard {...props} />);
  return { props, ran };
}

/** What phase 1 hands the browser for the debit card — PagBank's sandbox example data. */
const DEBIT_TEST = {
  amountCents: 2701,
  customer: { name: 'Jose da Silva', email: 'cliente@sandbox.pagseguro.com.br', phone: '+55 11 99999-9999' },
  billingAddress: {
    street: 'Avenida Brigadeiro Faria Lima',
    number: '1384',
    complement: 'apto 12',
    regionCode: 'SP',
    city: 'São Paulo',
    postalCode: '01452002',
  },
};

describe('HomologacaoEvidenceCard', () => {
  it('given the SDK, when generating, then only encrypted blobs reach the host and the counts are shown', async () => {
    const encryptCard = vi.fn((params: { number: string }) => ({
      hasErrors: false,
      encryptedCard: `enc-${params.number.slice(-4)}`,
    }));
    (window as { PagSeguro?: unknown }).PagSeguro = { encryptCard };
    const { props, ran } = mount();

    fireEvent.click(screen.getByTestId('evidence-generate'));

    await waitFor(() => expect(screen.getByTestId('evidence-summary-counts').textContent).toBe(
      '✓\u00a015\u00a0executados · ✗\u00a00\u00a0falharam · ⧗\u00a02\u00a0pendentes',
    ));
    expect(props.onRun).toHaveBeenCalledWith('run-1', expect.any(Array), expect.any(Array), expect.any(Function));
    expect(ran[0]?.map((card) => [card.scenario, card.encrypted])).toEqual([
      ['approved', 'enc-2097'],
      ['declined', 'enc-0766'],
      ['debit', 'enc-2701'],
    ]);
    // No 3DS session from this host: the debit card says so instead of being charged.
    expect(ran[0]?.[2]).toMatchObject({ failure: 'NO_THREEDS_SESSION' });
    expect(ran[0]?.[2]?.authenticationId).toBeUndefined();
    expect(JSON.stringify(ran)).not.toContain('4539620659922097');
    expect(encryptCard.mock.calls[0]?.[0]).toMatchObject({ publicKey: 'PUBKEY', securityCode: '123' });
    expect(screen.getByTestId('evidence-incomplete').textContent).toContain('Pendências');
  });

  it('given no public key, then the run still happens and each card says why it was not encrypted', async () => {
    const { ran } = mount({ onPrepare: vi.fn(async () => ({ runId: 'run-2', publicKey: null })) });

    fireEvent.click(screen.getByTestId('evidence-generate'));

    await waitFor(() => expect(ran).toHaveLength(1));
    expect(ran[0]?.map((card) => card.failure)).toEqual(['NO_PUBLIC_KEY', 'NO_PUBLIC_KEY', 'NO_PUBLIC_KEY']);
  });

  it('given a 3DS session, then the debit test card is authenticated for R$ 27,01 and only its id and blob reach the host (FUT-3755)', async () => {
    const encryptCard = vi.fn((params: { number: string }) => ({
      hasErrors: false,
      encryptedCard: `enc-${params.number.slice(-4)}`,
    }));
    const setUp = vi.fn();
    const authenticate3DS = vi.fn<(request: unknown) => Promise<Record<string, string>>>(async () => ({
      status: 'AUTH_FLOW_COMPLETED',
      authenticationStatus: 'AUTHENTICATED',
      id: '3DS_AUTH_1',
    }));
    (window as { PagSeguro?: unknown }).PagSeguro = { encryptCard, setUp, authenticate3DS };
    const session = { session: '3ds-session-1', expiresAt: 1_800_000_000_000, environment: 'SANDBOX' as const };
    const { ran } = mount({ onPrepare: vi.fn(async () => ({ runId: 'run-3', publicKey: 'PUBKEY', threeDSSession: session, debitTest: DEBIT_TEST })) });

    fireEvent.click(screen.getByTestId('evidence-generate'));

    await waitFor(() => expect(ran).toHaveLength(1));
    expect(setUp).toHaveBeenCalledWith({ session: '3ds-session-1', env: 'SANDBOX' });
    expect(authenticate3DS.mock.calls[0]?.[0]).toMatchObject({
      data: {
        paymentMethod: { type: 'DEBIT_CARD', installments: 1, card: { encrypted: 'enc-2701' } },
        amount: { value: 2701, currency: 'BRL' },
        customer: { name: 'Jose da Silva', phones: [{ country: '55', area: '11', type: 'MOBILE' }] },
        billingAddress: { regionCode: 'SP', country: 'BRA', postalCode: '01452002' },
      },
    });
    expect(ran[0]?.[2]).toEqual({
      scenario: 'debit',
      brand: 'VISA',
      masked: '4000 00** **** 2701',
      encrypted: 'enc-2701',
      authenticationId: '3DS_AUTH_1',
      authenticated: true,
    });
    expect(JSON.stringify(ran)).not.toContain('4000000000002701');
  });

  it('given PagBank refuses the 3DS authentication, then the debit card carries the refusal code and no id', async () => {
    const authenticate3DS = vi.fn(async () => ({ status: 'CHANGE_PAYMENT_METHOD' }));
    (window as { PagSeguro?: unknown }).PagSeguro = {
      encryptCard: () => ({ hasErrors: false, encryptedCard: 'enc' }),
      setUp: vi.fn(),
      authenticate3DS,
    };
    const session = { session: 's', expiresAt: 1, environment: 'SANDBOX' as const };
    const { ran } = mount({ onPrepare: vi.fn(async () => ({ runId: 'run-4', publicKey: 'PUBKEY', threeDSSession: session, debitTest: DEBIT_TEST })) });

    fireEvent.click(screen.getByTestId('evidence-generate'));

    await waitFor(() => expect(ran).toHaveLength(1));
    expect(ran[0]?.[2]).toMatchObject({ scenario: 'debit', failure: 'THREEDS_REFUSED' });
    expect(ran[0]?.[2]?.authenticationId).toBeUndefined();
  });

  it('when downloading the latest file, then nothing is run again', async () => {
    const { props } = mount();

    fireEvent.click(screen.getByTestId('evidence-download-latest'));

    await waitFor(() => expect(props.onDownload).toHaveBeenCalledTimes(1));
    expect(props.onPrepare).not.toHaveBeenCalled();
    expect(props.onRun).not.toHaveBeenCalled();
  });

  it('given a host failure, then the error is shown and no counts are', async () => {
    mount({ onPrepare: vi.fn(async () => Promise.reject(new Error('boom'))) });

    fireEvent.click(screen.getByTestId('evidence-generate'));

    // The phase that failed is named, and the way back still works.
    await waitFor(() => expect(screen.getByTestId('evidence-generate-failed').textContent).toContain('Falhou ao consultar'));
    expect(screen.getByTestId('evidence-generate-failed').textContent).toContain('Baixar o último registrado');
    expect(document.querySelectorAll('[data-testid="evidence-summary"]')).toHaveLength(0);
  });

  it('given no seller, then the card says the scenarios will stay pending and offers Connect', () => {
    mount({ seller: { ...SELLER, connected: false, connectedAt: null, accountId: null, status: null } });

    expect(screen.getByTestId('evidence-seller-state').textContent).toContain('ficam pendentes');
    expect(screen.getByTestId('evidence-connect').textContent).toBe('Conectar lojista de teste');
  });

  it('given a return from PagBank, then the outcome is announced', () => {
    mount({ connectOutcome: 'failed' });

    expect(screen.getByTestId('evidence-connect-outcome').textContent).toContain('não foi concluída');
  });

  it('given a "connected" return the seller row does not confirm, then nothing is announced', () => {
    mount({ connectOutcome: 'connected', seller: { ...SELLER, connected: false, connectedAt: null, accountId: null } });

    expect(document.querySelectorAll('[data-testid="evidence-connect-outcome"]')).toHaveLength(0);
  });

  it('given a failed return with a recorded reason, then the reason is shown, not just "see the file"', () => {
    mount({ connectOutcome: 'failed', seller: { ...SELLER, lastConnectProblem: 'O PagBank retornou ao callback com error=access_denied.' } });

    expect(screen.getByTestId('evidence-connect-outcome').textContent).toContain('error=access_denied');
  });

  it('given no seller, then connecting is the primary action and generating the secondary one', () => {
    mount({ seller: { ...SELLER, connected: false, connectedAt: null, accountId: null, status: null } });

    expect(screen.getByTestId('evidence-connect').className).toContain('MuiButton-contained');
    expect(screen.getByTestId('evidence-generate').className).toContain('MuiButton-outlined');
  });

  it('given a failed return with nothing recorded, then the fallback does not claim a recording', () => {
    mount({ connectOutcome: 'failed', seller: { ...SELLER, lastConnectProblem: null } });

    expect(screen.getByTestId('evidence-connect-outcome').textContent).toBe(
      'A conexão do lojista de teste não foi concluída. Tente conectar de novo.',
    );
  });

  it('given a run, then each step is marked done, current or pending as the host reports the sections (FUT-3755)', async () => {
    let section: ((name: 'PIX' | 'CARD' | 'DEBIT' | 'GOOGLE_PAY' | 'APPLE_PAY') => void) | undefined;
    let finish: (() => void) | undefined;
    (window as { PagSeguro?: unknown }).PagSeguro = { encryptCard: () => ({ hasErrors: false, encryptedCard: 'enc' }) };
    mount({
      onRun: vi.fn(
        (_runId: string, _cards: BrowserCardResult[], _wallets: unknown, onSection: typeof section) =>
          new Promise<void>((resolve) => {
            section = onSection;
            finish = resolve;
          }),
      ),
    });

    fireEvent.click(screen.getByTestId('evidence-generate'));
    await waitFor(() => expect(section).toBeDefined());
    act(() => section?.('DEBIT'));

    const states = () =>
      Array.from(screen.getByTestId('evidence-steps').querySelectorAll('li')).map((li) => [
        li.dataset['testid']?.replace('evidence-step-', ''),
        li.dataset['state'],
      ]);
    expect(states()).toEqual([
      ['prepare', 'done'],
      ['encrypt', 'done'],
      ['PIX', 'done'],
      ['CARD', 'done'],
      ['DEBIT', 'current'],
      ['GOOGLE_PAY', 'pending'],
      ['APPLE_PAY', 'pending'],
      ['file', 'pending'],
    ]);
    expect(screen.getByTestId('evidence-run-wallets').textContent).toBe(
      'Nenhuma carteira nesta geração. Google Pay e Apple Pay ficam pendentes.',
    );

    act(() => finish?.());
    await waitFor(() => expect(screen.queryByTestId('evidence-steps')).toBeNull());
  });

  it('given a download-only press, then no step list is drawn', async () => {
    let finish: ((summary: { executed: number; failed: number; pending: number }) => void) | undefined;
    mount({ onDownload: vi.fn(() => new Promise((resolve) => (finish = resolve))) });

    fireEvent.click(screen.getByTestId('evidence-download-latest'));

    await waitFor(() => expect(screen.getByTestId('evidence-phase')).toBeDefined());
    expect(screen.queryByTestId('evidence-steps')).toBeNull();
    expect(screen.queryByTestId('evidence-run-wallets')).toBeNull();
    act(() => finish?.({ executed: 1, failed: 0, pending: 0 }));
    await waitFor(() => expect(screen.getByTestId('evidence-summary')).toBeDefined());
  });
});
