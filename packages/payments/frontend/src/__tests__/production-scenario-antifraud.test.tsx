// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ProductionScenarioList } from '../components/platform/ProductionScenarioList';
import { EN_US_PLATFORM_HOMOLOGACAO_COPY } from '../components/platform/en-US';
import { PT_BR_PLATFORM_HOMOLOGACAO_COPY } from '../components/platform/pt-BR';

/**
 * FUT-5512: a scenario PagBank's own antifraud refused (`ANTIFRAUD_DECLINED`)
 * says so, instead of sending the operator to the card's bank; an issuer
 * decline keeps its sentence.
 */

afterEach(cleanup);

const outcomes = [
  { scenario: 'credit', status: 'EXECUTED', reason: null },
  { scenario: 'debit', status: 'FAILED', reason: 'ISSUER_DECLINED' },
  { scenario: 'pix', status: 'PENDING', reason: null },
  { scenario: 'googlePay', status: 'EXECUTED', reason: null },
  { scenario: 'applePay', status: 'FAILED', reason: 'ANTIFRAUD_DECLINED' },
] as const;

describe('the antifraud reason (FUT-5512)', () => {
  it('says the antifraud refused the Apple Pay charge, and the bank the debit', () => {
    const copy = PT_BR_PLATFORM_HOMOLOGACAO_COPY.productionEvidence.scenarios;
    render(<ProductionScenarioList copy={copy} scenarios={outcomes} pix={null} checking={false} onRetryRefund={() => undefined} retrying={false} />);

    expect(screen.getByText(/Apple Pay/).closest('li')?.textContent).toContain('o antifraude do PagBank recusou o pagamento');
    expect(screen.getByText(/Apple Pay/).closest('li')?.textContent).not.toContain('o banco recusou');
    expect(screen.getByText(/Débito/).closest('li')?.textContent).toContain('o banco recusou o cartão de débito');
  });

  it('has the sentence in English too', () => {
    expect(EN_US_PLATFORM_HOMOLOGACAO_COPY.productionEvidence.scenarios.reasons.antifraudDeclined).toMatch(/PagBank's antifraud/);
  });
});
