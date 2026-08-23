// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { HomologacaoGuide } from '@12-apps/payments-backend';

import { PlatformHomologacao } from '../components/platform/PlatformHomologacao';
import type {
  HomologacaoSaveInput,
  HomologacaoSaveState,
  PlatformHomologationRecordView,
} from '../components/platform/HomologacaoOutcomeCard';
import { PT_BR_PLATFORM_HOMOLOGACAO_COPY } from '../components/platform/pt-BR';

/**
 * The platform homologação screen (FUT-483, packaged by FUT-573). Pinned: the
 * absent record renders the honest "não solicitada" (displayed, never
 * offered), each recorded status gets its own chip, the guide names BOTH
 * services, the save flow hands the form to the host verbatim, and the anexo
 * card surfaces the host's own refusal reason.
 *
 * jest-dom is not a dependency here, so DOM properties are asserted directly.
 */

const GUIDE: HomologacaoGuide = {
  formUrl: 'https://app.pipefy.com/public/form/2e56YZLK',
  supportFormUrl: 'https://app.pipefy.com/public/form/sBlh9Nq6',
  docsUrl: 'https://developer.pagbank.com.br/docs/solicitar-homologacao',
  exampleUrl: 'https://dev.pagbank.uol.com.br/reference/criar-pagar-pedido-com-cartao',
  integrationType: 'Desenvolvimento próprio',
  services: ['API de Pedidos e Pagamentos (Order)', 'API Connect'],
  accessInstructions: 'Acesse https://app.example.com/demo-balcao/menu.',
  siteUrl: 'https://app.example.com',
  demoStoreUrl: 'https://app.example.com/demo-balcao/menu',
  productsDescription: 'Plataforma Aurora de cardápio digital.',
  slaText: 'Prazo (SLA): até 4 dias úteis.',
  fieldLabels: {
    integrationType: 'Selecione o tipo de integração',
    services: 'Selecione qual serviço você integrou (marque OS DOIS)',
    accessInstructions: 'Instruções de acesso ao seu ambiente (limite de 255 caracteres)',
    siteUrl: 'URL do site',
    productsDescription: 'Detalhe quais produtos/serviços serão comercializados',
  },
};

const IDLE: HomologacaoSaveState = { pending: false, error: null, success: false };

function record(over: Partial<PlatformHomologationRecordView>): PlatformHomologationRecordView {
  return {
    provider: 'pagbank',
    status: 'SUBMITTED',
    protocol: null,
    notes: null,
    submittedAt: '2026-08-01T10:00:00.000Z',
    decidedAt: null,
    updatedBy: 'ops@example.com',
    updatedAt: '2026-08-01T10:00:00.000Z',
    ...over,
  };
}

function renderScreen(over: Partial<Parameters<typeof PlatformHomologacao>[0]> = {}) {
  const saved: HomologacaoSaveInput[] = [];
  render(
    <PlatformHomologacao copy={PT_BR_PLATFORM_HOMOLOGACAO_COPY}
      record={null}
      guide={GUIDE}
      onSaveRecord={(input) => saved.push(input)}
      save={IDLE}
      onGenerateAnexo={async () => undefined}
      {...over}
    />,
  );
  return { saved };
}

afterEach(cleanup);

describe('PlatformHomologacao', () => {
  it('renders the absent record as "não solicitada" — displayed, never a choice', () => {
    renderScreen();

    expect(screen.getByTestId('homologacao-status-chip').textContent).toBe(PT_BR_PLATFORM_HOMOLOGACAO_COPY.outcome.notSubmitted);
    const select = screen.getByTestId<HTMLSelectElement>('homologacao-status-select');
    const offered = Array.from(select.options).map((option) => option.value);
    expect(offered).toEqual(['SUBMITTED', 'APPROVED', 'REJECTED']);
  });

  it('renders each recorded status with its own chip and trail', () => {
    renderScreen({
      record: record({ status: 'APPROVED', decidedAt: '2026-08-05T09:00:00.000Z' }),
    });

    expect(screen.getByTestId('homologacao-status-chip').textContent).toBe(PT_BR_PLATFORM_HOMOLOGACAO_COPY.outcome.statuses.APPROVED);
    expect(screen.getByTestId('homologacao-outcome-card').textContent).toContain(
      PT_BR_PLATFORM_HOMOLOGACAO_COPY.outcome.recordedBy('ops@example.com'),
    );
  });

  it('shows the rejected outcome too — a refusal is a first-class answer', () => {
    renderScreen({ record: record({ status: 'REJECTED' }) });

    expect(screen.getByTestId('homologacao-status-chip').textContent).toBe(PT_BR_PLATFORM_HOMOLOGACAO_COPY.outcome.statuses.REJECTED);
  });

  it('names BOTH services and links the official form', () => {
    renderScreen();

    expect(screen.getByTestId('homologacao-form-link').getAttribute('href')).toBe(GUIDE.formUrl);
    const services = screen.getByTestId('homologacao-services').textContent ?? '';
    expect(services).toContain('API de Pedidos e Pagamentos (Order)');
    expect(services).toContain('API Connect');
  });

  it('hands the outcome form to the host verbatim', () => {
    const { saved } = renderScreen();

    fireEvent.change(screen.getByTestId('homologacao-status-select'), {
      target: { value: 'APPROVED' },
    });
    fireEvent.change(screen.getByTestId('homologacao-protocol'), {
      target: { value: 'PIPE-123' },
    });
    fireEvent.change(screen.getByTestId('homologacao-notes'), {
      target: { value: 'aprovado em 4 dias' },
    });
    fireEvent.click(screen.getByTestId('homologacao-save'));

    expect(saved).toEqual([
      { status: 'APPROVED', protocol: 'PIPE-123', notes: 'aprovado em 4 dias' },
    ]);
  });

  it('mirrors the host save state: pending disables, error and success surface', () => {
    renderScreen({ save: { pending: true, error: null, success: false } });
    expect(screen.getByTestId<HTMLButtonElement>('homologacao-save').disabled).toBe(true);
    cleanup();

    renderScreen({ save: { pending: false, error: 'Sessão expirada.', success: false } });
    expect(screen.getByTestId('homologacao-save-error').textContent).toContain(
      'Sessão expirada.',
    );
    cleanup();

    renderScreen({ save: { pending: false, error: null, success: true } });
    expect(screen.getByTestId('homologacao-save-ok').textContent).toContain(
      PT_BR_PLATFORM_HOMOLOGACAO_COPY.outcome.saved,
    );
  });

  it('surfaces the host reason when the anexo generator refuses', async () => {
    renderScreen({
      onGenerateAnexo: async () => {
        throw new Error('Falta o token de sandbox da plataforma.');
      },
    });

    fireEvent.click(screen.getByTestId('homologacao-anexo-button'));

    await waitFor(() => {
      expect(screen.getByTestId('homologacao-anexo-error').textContent).toContain(
        'Falta o token de sandbox da plataforma.',
      );
    });
  });

  it('clears the previous refusal when a later generation succeeds', async () => {
    const attempts = { count: 0 };
    renderScreen({
      onGenerateAnexo: async () => {
        attempts.count += 1;
        if (attempts.count === 1) throw new Error('Tente novamente.');
      },
    });

    fireEvent.click(screen.getByTestId('homologacao-anexo-button'));
    await waitFor(() => {
      expect(screen.queryByTestId('homologacao-anexo-error')).not.toBeNull();
    });

    fireEvent.click(screen.getByTestId('homologacao-anexo-button'));
    await waitFor(() => {
      expect(screen.queryByTestId('homologacao-anexo-error')).toBeNull();
    });
    expect(attempts.count).toBe(2);
  });
});
