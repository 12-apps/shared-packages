// @vitest-environment jsdom
// render/screen from @testing-library/react — plain DOM asserts, no jest-dom.
import { render, screen, waitFor } from '@testing-library/react';
import type { ResearchMessages } from '../messages';
import { PT_BR_RESEARCH_MESSAGES } from '../pt-BR';
import { describe, expect, it } from 'vitest';


import { SourceStatusList } from '../source-status';
import type { SourceStatView } from '../types';

/**
 * FUT-495: a failed source must say WHY, on the screen. The production case —
 * tenant future-drink's Atacadão source — showed one word, "indisponível", while
 * the run had stored a perfectly specific reason nobody could see.
 */
const sourceStat = (overrides: Partial<SourceStatView> = {}): SourceStatView => ({
  sourceId: 's1',
  type: 'VTEX',
  name: 'Atacadão',
  status: 'FAILED',
  offerCount: 0,
  ms: 1_300,
  ...overrides,
});

const BLOCKED =
  'Busca no catálogo VTEX falhou: a loja recusou nosso acesso (HTTP 403 — bloqueio de bot ' +
  'ou de IP). Endereço: https://www.atacadao.com.br/api/catalog_system/pub/products/search';

const renderList = (stats: SourceStatView[], messages?: Partial<ResearchMessages>) =>
  render(
    <SourceStatusList
      sources={[]}
      stats={stats}
      running={false}
      messages={{ ...PT_BR_RESEARCH_MESSAGES, ...messages }}
    />,
  );

describe('SourceStatusList — failure reasons (FUT-495)', () => {
  it('shows the recorded reason under the failed row, not just the status word', () => {
    renderList([sourceStat({ error: BLOCKED })]);

    const row = screen.getByTestId('source-status-s1');
    expect(row.textContent).toContain('indisponível');
    const reason = screen.getByTestId('source-status-reason-s1');
    expect(reason.textContent).toContain('Motivo:');
    expect(reason.textContent).toContain('HTTP 403');
  });

  it('truncates the row line but keeps the FULL reason reachable and announced', async () => {
    renderList([sourceStat({ error: BLOCKED })]);

    const line = screen.getByTestId('source-status-reason-s1').textContent ?? '';
    // Truncated for layout — with the ellipsis that says so.
    expect(line.length).toBeLessThan(BLOCKED.length);
    expect(line).toContain('…');

    // …and the whole sentence lives in the chip's accessible description, in
    // the DOM (not behind a hover), which is what a screen reader announces.
    const why = screen.getByTestId('source-status-why-s1');
    expect(why.textContent).toContain('bloqueio de bot');
    expect(why.textContent).toContain('Endereço: https://www.atacadao.com.br');
    // Reachable without a pointer: touch and keyboard users get it too.
    await waitFor(() => expect(why.getAttribute('tabindex')).toBe('0'));
  });

  it('bounds a legacy unbounded reason before it reaches the description (FUT-517)', () => {
    // Runs recorded before FUT-517 echoed the vendor's error body whole — an
    // HTML error page included. The connector bounds at write time now; this
    // is the render-time half, for the rows already in the database.
    renderList([sourceStat({ error: 'provedor indisponível '.repeat(300) })]);

    const why = screen.getByTestId('source-status-why-s1').textContent ?? '';
    expect(why.length).toBeLessThan(600);
    expect(why.endsWith('…')).toBe(true);
    // The row line keeps its own, much tighter cap on top of that.
    const line = screen.getByTestId('source-status-reason-s1').textContent ?? '';
    expect(line.length).toBeLessThan(why.length);
  });

  it('NEVER renders a query string, whatever the run recorded', () => {
    // Exactly what production stored before this ticket — key-bearing shape.
    renderList([
      sourceStat({
        error:
          'VTEX catalog search unreachable: https://www.atacadao.com.br/api/catalog_system/' +
          'pub/products/search?ft=coca%20cola%20220ml&apiKey=super-secret',
      }),
    ]);

    const row = screen.getByTestId('source-status-s1').textContent ?? '';
    expect(row).toContain('https://www.atacadao.com.br/api/catalog_system/pub/products/search');
    expect(row).not.toContain('?');
    expect(row).not.toContain('super-secret');
  });

  it('NEVER renders URL credentials either — the visible line, the tooltip or the description', () => {
    // A source URL may legitimately carry userinfo (`publicUrlViolation` vets
    // only scheme/host/address), and a LEGACY stored reason kept the raw URL —
    // which is exactly the input this render-time pass exists for. Cutting at
    // `?` alone stripped the query and left the token on screen.
    renderList([
      sourceStat({
        error:
          'VTEX catalog search unreachable: https://user:tok3n@www.loja.com.br/api/' +
          'catalog_system/pub/products/search?ft=coca',
      }),
    ]);

    const row = screen.getByTestId('source-status-s1').textContent ?? '';
    const why = screen.getByTestId('source-status-why-s1').textContent ?? '';
    for (const rendered of [row, why]) {
      expect(rendered).not.toContain('tok3n');
      expect(rendered).not.toContain('user:');
    }
    // The endpoint itself is still there — it is the diagnostic half.
    expect(why).toContain('https://www.loja.com.br/api/catalog_system/pub/products/search');
  });

  it('still says something when the source recorded no reason at all', () => {
    renderList([sourceStat({})]);

    expect(screen.getByTestId('source-status-reason-s1').textContent).toContain(
      PT_BR_RESEARCH_MESSAGES.statusReasonUnknown,
    );
  });

  it('surfaces a budget cap reason when there is one, and stays quiet when there is not', () => {
    renderList([
      sourceStat({ sourceId: 'capped', status: 'BUDGET_EXCEEDED', error: 'cota diária esgotada' }),
      sourceStat({ sourceId: 'quiet', status: 'BUDGET_EXCEEDED' }),
    ]);

    expect(screen.getByTestId('source-status-reason-capped').textContent).toContain(
      'cota diária esgotada',
    );
    expect(screen.getByTestId('source-status-quiet').textContent).toContain(
      'limite de consultas atingido',
    );
    expect(screen.getByTestId('source-status-quiet').textContent).not.toContain('Motivo:');
  });

  it('adds no reason line to a source that answered', () => {
    renderList([sourceStat({ status: 'OK', offerCount: 4, error: undefined })]);

    const row = screen.getByTestId('source-status-s1').textContent ?? '';
    expect(row).toContain('4 oferta(s)');
    expect(row).not.toContain('Motivo:');
  });

  it('routes the reason copy through the messages layer', () => {
    renderList([sourceStat({ error: 'HTTP 403' })], {
      statusFailed: 'unavailable',
      statusFailureReason: (reason) => `Why: ${reason}`,
    });

    const row = screen.getByTestId('source-status-s1').textContent ?? '';
    expect(row).toContain('unavailable');
    expect(row).toContain('Why: HTTP 403');
  });
});

describe('SourceStatusList — out-of-area caveat accessibility (FUT-491 review)', () => {
  it('announces the out-of-area explanation instead of hiding it in a native title', async () => {
    renderList([sourceStat({ status: 'OK', offerCount: 4, outsideDeliveryArea: true })]);

    const chip = screen.getByTestId('source-status-outside-area-s1');
    expect(chip.textContent).toContain('4 oferta(s) · outra região');
    // Same accessible shape as the failure reason: text in the DOM, focusable.
    expect(chip.textContent).toContain('região padrão da loja');
    await waitFor(() => expect(chip.getAttribute('tabindex')).toBe('0'));
  });

  it('reads a not-served source that found NOTHING as such (FUT-495)', () => {
    // The pipeline now derives this from the connector's verdict, so a store
    // that does not deliver here still says so with zero offers.
    renderList([sourceStat({ status: 'OK', offerCount: 0, outsideDeliveryArea: true })]);

    expect(screen.getByTestId('source-status-s1').textContent).toContain(
      '0 oferta(s) · outra região',
    );
  });
});

/**
 * FUT-516: a source cut short by the per-source time ceiling. The requirement
 * this block exists for is the FUT-514 defect not returning quietly — a
 * truncated VTEX answer has NO delivery flags by construction, so its offers
 * must never render exactly like verified ones.
 */
describe('SourceStatusList — the truncated caveat (FUT-516)', () => {
  it('says the search was cut and explains what that costs, reachably', async () => {
    renderList([sourceStat({ status: 'OK', offerCount: 3, truncated: true })]);

    const chip = screen.getByTestId('source-status-truncated-s1');
    expect(chip.textContent).toContain('3 oferta(s) · busca interrompida');
    // The two halves an operator needs: the list may be short, AND delivery to
    // the CEP was not verified.
    expect(chip.textContent).toContain('lista pode estar incompleta');
    expect(chip.textContent).toContain('entrega no CEP');
    // Same accessible shape as its neighbours: in the DOM, and focusable.
    await waitFor(() => expect(chip.getAttribute('tabindex')).toBe('0'));
  });

  it('marks a truncated CACHE hit too — the retry must not read as complete', () => {
    renderList([sourceStat({ status: 'CACHED', offerCount: 2, truncated: true })]);

    expect(screen.getByTestId('source-status-s1').textContent).toContain(
      '2 oferta(s) · busca interrompida · cache',
    );
  });

  it('gives outside-area precedence when a stat carries both flags', async () => {
    // One chip, one sentence: the buyer reads the one that can cost them an
    // order. Out-of-area is a claim about the PRICE they are looking at;
    // truncation is a claim about the list around it.
    renderList([
      sourceStat({ status: 'OK', offerCount: 4, truncated: true, outsideDeliveryArea: true }),
    ]);

    const chip = screen.getByTestId('source-status-outside-area-s1');
    expect(chip.textContent).toContain('4 oferta(s) · outra região');
    expect(chip.textContent).toContain('região padrão da loja');
    await waitFor(() =>
      expect(screen.queryByTestId('source-status-truncated-s1')).toBeNull(),
    );
  });

  it('leaves an ordinary complete answer with no caveat chip at all', async () => {
    renderList([sourceStat({ status: 'OK', offerCount: 5 })]);

    expect(screen.getByTestId('source-status-s1').textContent).toContain('5 oferta(s)');
    await waitFor(() =>
      expect(screen.queryByTestId('source-status-truncated-s1')).toBeNull(),
    );
  });

  it('renders a FAILED + truncated stat through its recorded reason, unchanged', () => {
    // `statReason` needs no truncated arm: the pipeline records the ceiling
    // sentence as the stat's error, so the existing failure row already tells
    // the whole story — and it must not ALSO claim to have found offers.
    renderList([
      sourceStat({
        status: 'FAILED',
        truncated: true,
        error: 'A consulta a esta fonte atingiu o tempo total permitido e foi interrompida.',
      }),
    ]);

    expect(screen.getByTestId('source-status-s1').textContent).toContain('indisponível');
    expect(screen.getByTestId('source-status-reason-s1').textContent).toContain(
      'tempo total permitido',
    );
  });
});
