// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    expect(props.onRun).toHaveBeenCalledWith('run-1', expect.any(Array));
    expect(ran[0]?.map((card) => [card.scenario, card.encrypted])).toEqual([
      ['approved', 'enc-2097'],
      ['declined', 'enc-0766'],
    ]);
    expect(JSON.stringify(ran)).not.toContain('4539620659922097');
    expect(encryptCard.mock.calls[0]?.[0]).toMatchObject({ publicKey: 'PUBKEY', securityCode: '123' });
    expect(screen.getByTestId('evidence-incomplete').textContent).toContain('Pendências');
  });

  it('given no public key, then the run still happens and each card says why it was not encrypted', async () => {
    const { ran } = mount({ onPrepare: vi.fn(async () => ({ runId: 'run-2', publicKey: null })) });

    fireEvent.click(screen.getByTestId('evidence-generate'));

    await waitFor(() => expect(ran).toHaveLength(1));
    expect(ran[0]?.map((card) => card.failure)).toEqual(['NO_PUBLIC_KEY', 'NO_PUBLIC_KEY']);
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
});
