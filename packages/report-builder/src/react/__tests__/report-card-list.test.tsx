// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { renderWithCopy as render } from './with-copy';

import type { SavedReportSummary } from '../custom-reports-api';
import { ReportCardList } from '../report-card-list';

/**
 * Plan entry 21 as a GRID of cards (FUT-755) — `prototype.html`'s
 * `renderList()`.
 *
 * The screen it replaces was one full-width row per report with the filters
 * threaded through the middle, so what these cases actually pin is the
 * information architecture: three scopes including `Meus` (which needed the
 * server's `ownedByMe` before it could exist), a search, and a card that says
 * how big the report is, who can read it and how stale it is.
 *
 * Every negative here is paired with a positive in the same test — a `Meus`
 * assertion that only checks what is ABSENT passes against a grid that
 * rendered nothing at all, which is the failure mode a screen-level suite is
 * most likely to have.
 */

const NOW = new Date('2026-08-10T12:00:00.000Z');
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

function report(patch: Partial<SavedReportSummary> & { id: string }): SavedReportSummary {
  return {
    name: 'Relatório',
    description: null,
    type: 'dashboard',
    entity: '',
    entities: ['orders'],
    blockCount: 3,
    status: 'published',
    visibility: 'tenant',
    ownedByMe: false,
    updatedAt: new Date(NOW.getTime() - 2 * HOUR_MS).toISOString(),
    ...patch } as SavedReportSummary;
}

const REPORTS: SavedReportSummary[] = [
  report({
    id: 'meu',
    name: 'Vendas por dia',
    description: 'Receita diária da loja',
    ownedByMe: true,
    blockCount: 4,
    updatedAt: new Date(NOW.getTime() - 3 * DAY_MS).toISOString() }),
  report({
    id: 'equipe',
    name: 'Cozinha',
    visibility: 'private',
    blockCount: 1,
    updatedAt: new Date(NOW.getTime() - 2 * HOUR_MS).toISOString() }),
  report({
    id: 'rascunho',
    name: 'Ticket médio',
    status: 'draft',
    ownedByMe: true,
    // Explicit rather than shared with `equipe`: two equal timestamps would
    // leave the grid's order resting on sort stability, which is not what the
    // ordering assertions below are about.
    updatedAt: new Date(NOW.getTime() - 5 * HOUR_MS).toISOString() }),
  report({ id: 'velho', name: 'Antigo', status: 'archived' }),
];

/**
 * Everything the list called back with, per render. A container mutated by the
 * handlers rather than closed-over bindings reassigned inside them: the
 * flakiness gate rejects the latter.
 */
const calls = {
  selected: [] as string[],
  edited: [] as string[],
  filed: [] as string[],
  created: 0,
  scopes: [] as string[] };

const realMatchMedia = window.matchMedia;

/**
 * jsdom implements no `matchMedia`, and MUI reads it. Installed per test and
 * restored after, so the stub cannot leak into another suite.
 */
beforeEach(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  calls.selected = [];
  calls.edited = [];
  calls.filed = [];
  calls.created = 0;
  calls.scopes = [];
});

afterEach(() => {
  cleanup();
  window.matchMedia = realMatchMedia;
});

function renderList(
  props: Partial<Parameters<typeof ReportCardList>[0]> = {},
): void {
  render(
    <ReportCardList
      reports={REPORTS}
      scope="active"
      search=""
      now={NOW}
      onScopeChange={(next) => calls.scopes.push(next)}
      onSearchChange={() => undefined}
      onSelect={(id) => calls.selected.push(id)}
      onEdit={(id) => calls.edited.push(id)}
      onArchive={(report) => calls.filed.push(report.id)}
      onCreate={() => {
        calls.created += 1;
      }}
      {...props}
    />,
  );
}

/** The ids of the cards actually on screen, in grid order. */
function cardIds(): string[] {
  return Array.from(screen.getByTestId('reports-card-list').querySelectorAll('[data-testid]'))
    .map((node) => node.getAttribute('data-testid') ?? '')
    .filter((id) => id.startsWith('reports-card-') && !id.endsWith('-open') && !id.endsWith('-menu'))
    .map((id) => id.replace('reports-card-', ''));
}

describe('the three scopes', () => {
  it('shows everything un-archived under Todos', () => {
    renderList();
    expect(cardIds()).toEqual(['equipe', 'rascunho', 'meu', 'new']);
  });

  it('shows only the caller’s reports under Meus', () => {
    renderList({ scope: 'mine' });
    const ids = cardIds();
    // Positive first: the grid rendered, and it rendered the OWNED reports…
    expect(ids).toContain('meu');
    expect(ids).toContain('rascunho');
    // …so the absence below is a filter, not an empty render.
    expect(ids).not.toContain('equipe');
  });

  it('shows only the archive under Arquivados', () => {
    renderList({ scope: 'archived' });
    expect(cardIds()).toEqual(['velho', 'new']);
  });

  it('marks the current scope pressed and the others not', () => {
    renderList({ scope: 'mine' });
    expect(screen.getByTestId('reports-scope-mine').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('reports-scope-active').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('reports-scope-archived').getAttribute('aria-pressed')).toBe('false');
  });

  it('reports a scope change rather than filtering on its own', () => {
    renderList();
    fireEvent.click(screen.getByTestId('reports-scope-archived'));
    expect(calls.scopes).toEqual(['archived']);
  });
});

describe('search', () => {
  it('narrows the grid to the matching cards', () => {
    renderList({ search: 'cozinha' });
    expect(cardIds()).toEqual(['equipe', 'new']);
  });

  it('matches descriptions, accent- and case-insensitively', () => {
    renderList({ search: 'DIARIA' });
    expect(cardIds()).toEqual(['meu', 'new']);
  });
});

describe('a card', () => {
  it('says how many blocks, who can read it and when it changed', () => {
    renderList();
    const card = screen.getByTestId('reports-card-meu');
    expect(card.textContent).toContain('Vendas por dia');
    expect(card.textContent).toContain('4 blocos');
    expect(card.textContent).toContain('Toda a equipe');
    expect(card.textContent).toContain('há 3 dias');
  });

  it('says “Só você” for a private report, and counts one block in the singular', () => {
    renderList();
    const card = screen.getByTestId('reports-card-equipe');
    expect(card.textContent).toContain('1 bloco');
    expect(card.textContent).not.toContain('1 blocos');
    expect(card.textContent).toContain('Só você');
  });

  it('falls back to “Sem descrição.” rather than leaving a gap', () => {
    renderList();
    expect(screen.getByTestId('reports-card-equipe').textContent).toContain('Sem descrição.');
  });

  it('opens the report from the card itself', () => {
    renderList();
    fireEvent.click(screen.getByTestId('reports-card-meu-open'));
    expect(calls.selected).toEqual(['meu']);
  });
});

describe('the status chip', () => {
  it('marks a draft, and only a draft', () => {
    renderList();
    // Positive control: the published card is on screen in the same render…
    expect(screen.getByTestId('reports-card-equipe').textContent).not.toContain('Rascunho');
    expect(screen.getByTestId('reports-card-rascunho').textContent).toContain('Rascunho');
  });

  it('marks an archived report as archived', () => {
    renderList({ scope: 'archived' });
    expect(screen.getByTestId('reports-card-velho').textContent).toContain('Arquivado');
  });
});

describe('the ⋮ menu', () => {
  /**
   * The prototype reveals it with `:hover` AND `:focus-within`. jsdom has no
   * layout, so this cannot measure opacity — what it CAN prove is the part
   * that actually excludes a keyboard user: the trigger is a real focusable
   * control that opens its menu with no pointer event of any kind. A
   * hover-only implementation (a menu mounted on `onMouseEnter`) fails here.
   */
  it('is a real control, and works with no pointer event at all', async () => {
    renderList();
    const trigger = screen.getByTestId('reports-card-meu-menu');

    // Tab-reachable by construction: an enabled `<button>`, not a `div`
    // painted like one — and a SIBLING of the card's open button rather than a
    // child of it, because a button nested in a button is dropped by the
    // parser and takes the ⋮ with it. That is the shape the prototype has.
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger.hasAttribute('disabled')).toBe(false);
    expect(screen.getByTestId('reports-card-meu-open').contains(trigger)).toBe(false);

    // Enter on a focused button IS a click. No hover, no mouseenter.
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByText('Editar'));

    expect(calls.edited).toEqual(['meu']);
    // …and reaching the menu did not also open the report underneath it.
    expect(calls.selected).toEqual([]);
  });

  /**
   * Archiving used to be reachable from the report rendered UNDER the list.
   * Now that opening a report navigates away, the card menu is the only place
   * that cost can be paid back — so it is the card menu that has to offer it.
   */
  it('offers Arquivar on an active report, and asks the caller to run it', async () => {
    renderList();

    fireEvent.click(screen.getByTestId('reports-card-meu-menu'));
    const items = (await screen.findAllByRole('menuitem')).map((item) => item.textContent);
    expect(items).toEqual(['Editar', 'Arquivar']);

    fireEvent.click(screen.getByText('Arquivar'));
    // The write and its confirmation belong to the caller — the grid stays
    // presentational and cannot archive behind the operator's back.
    expect(calls.filed).toEqual(['meu']);
  });

  it('offers Restaurar instead once the report is archived', async () => {
    renderList({ scope: 'archived' });

    fireEvent.click(screen.getByTestId('reports-card-velho-menu'));
    const items = (await screen.findAllByRole('menuitem')).map((item) => item.textContent);
    expect(items).toEqual(['Editar', 'Restaurar']);
  });

  /**
   * The reveal rule itself, read off the stylesheet the card actually emitted.
   *
   * jsdom has no layout, so nothing here can measure opacity — but the failure
   * this guards is not a pixel, it is a MISSING SELECTOR: `:hover` alone leaves
   * the ⋮ permanently invisible to a keyboard, and that regression is one
   * deleted clause with no other symptom. Asserting `:hover` too keeps the
   * check honest about what it read.
   */
  it('reveals on focus as well as on hover', () => {
    renderList();
    const css = Array.from(document.querySelectorAll('style'))
      .map((tag) => tag.textContent ?? '')
      .join('\n');
    const reveal = css
      .split('}')
      .filter((rule) => rule.includes('data-report-card-menu'))
      .join('\n');

    // Positive control: the rule exists at all before either half is claimed.
    expect(reveal).not.toBe('');
    expect(reveal).toContain(':focus-within');
    expect(reveal).toContain(':hover');
  });

  it('names the report it acts on', () => {
    renderList();
    expect(screen.getByTestId('reports-card-meu-menu').getAttribute('aria-label')).toBe(
      'Mais ações de Vendas por dia',
    );
  });
});

describe('the new-report tile', () => {
  it('closes the grid, and creates', () => {
    renderList();
    // It is the LAST cell, after the cards — the affordance where the eye ends.
    expect(cardIds().at(-1)).toBe('new');
    fireEvent.click(screen.getByTestId('reports-card-new'));
    expect(calls.created).toBe(1);
  });

  it('is not the only way in — the toolbar still offers one', () => {
    renderList();
    fireEvent.click(screen.getByTestId('reports-new'));
    expect(calls.created).toBe(1);
  });
});

describe('the empty state', () => {
  it('invites a first report when the scope is simply empty', () => {
    renderList({ reports: [] });
    const empty = screen.getByTestId('reports-empty');
    expect(empty.textContent).toContain('Nenhum relatório aqui.');
    expect(empty.textContent).toContain('Monte o primeiro com receita por dia');
    expect(empty.textContent).not.toContain('Tente outro termo.');
  });

  it('says the search is the problem when a search is active', () => {
    renderList({ search: 'zzzz' });
    const empty = screen.getByTestId('reports-empty');
    expect(empty.textContent).toContain('Nenhum relatório aqui.');
    expect(empty.textContent).toContain('Tente outro termo.');
    expect(empty.textContent).not.toContain('Monte o primeiro');
  });

  it('offers a way out of both', () => {
    renderList({ reports: [] });
    fireEvent.click(screen.getByTestId('reports-empty-primary-action'));
    expect(calls.created).toBe(1);
  });

  it('drops the new-report tile with it, so the screen holds one invitation', () => {
    renderList({ reports: [] });
    expect(screen.queryByTestId('reports-card-new')).toBe(null);
  });
});
