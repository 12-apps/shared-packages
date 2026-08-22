// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithCopy as render } from './with-copy';
import { MemoryRouter } from 'react-router-dom';

import { editorSubtitle, ReportEditorHeader } from '../report-editor-header';
import { ReportSettingsDialog } from '../report-settings-dialog';
import type { PublishDraft } from '../lib/publish-section';
import { PT_BR_REPORT_SCREENS_COPY } from '../pt-BR';

/** The header's words, from the pack a host would pass. */
const SCREENS = PT_BR_REPORT_SCREENS_COPY;

/**
 * GAP 8 — the edit-mode header, and where the report's settings went.
 *
 * The user's words: *"this is the header when you're editing a report. If you
 * need edit name, description, etc. you click in ajustes"*. What shipped was a
 * back link, an h1, a paragraph and then four stacked form controls, so the
 * first screen of composing a report was a form.
 *
 * Two claims are worth pinning here and cannot be read off a screenshot:
 *
 *  - the subtitle is DERIVED. "0 blocos · só você" changes as blocks are added
 *    and as sharing is switched, and the singular is the case a naive
 *    `${n} blocos` gets wrong — on the most common count of all.
 *  - the header WRAPS. This area has shipped a header that overflowed at 390px
 *    and pushed its only edit affordance off screen. jsdom has no layout
 *    engine, so the proof available here is structural: every control is in the
 *    document and reachable, and the row is allowed to wrap rather than clip.
 */

const PUBLISH: PublishDraft = { status: 'draft', visibility: 'private', visibilityRoles: [] };

const realMatchMedia = window.matchMedia;

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
});

afterEach(() => {
  cleanup();
  window.matchMedia = realMatchMedia;
});

/** What a click did, collected on a container rather than a rebound binding. */
function recorder(): { calls: string[]; on: (name: string) => () => void } {
  const calls: string[] = [];
  return { calls, on: (name) => () => calls.push(name) };
}

function renderHeader(
  overrides: Partial<Parameters<typeof ReportEditorHeader>[0]> = {},
): ReturnType<typeof recorder> {
  const events = recorder();
  render(
    <MemoryRouter>
      <ReportEditorHeader
        tenantSlug="acme"
        name="Painel da loja"
        publish={PUBLISH}
        blockCount={0}
        saving={false}
        dirty={false}
        onNameChange={() => undefined}
        onOpenSettings={events.on('settings')}
        onCancel={events.on('cancel')}
        onSave={events.on('save')}
        {...overrides}
      />
    </MemoryRouter>,
  );
  return events;
}

describe('editorSubtitle', () => {
  it('gets the singular right', () => {
    expect(editorSubtitle(1, PUBLISH, SCREENS)).toBe('1 bloco · só você');
  });

  it('uses the plural everywhere else, zero included', () => {
    expect(editorSubtitle(0, PUBLISH, SCREENS)).toBe('0 blocos · só você');
    expect(editorSubtitle(3, PUBLISH, SCREENS)).toBe('3 blocos · só você');
  });

  it('names the sharing rule in the same words the dialog offers', () => {
    expect(editorSubtitle(2, { ...PUBLISH, visibility: 'tenant' }, SCREENS)).toBe('2 blocos · toda a equipe');
    expect(editorSubtitle(2, { ...PUBLISH, visibility: 'roles' }, SCREENS)).toBe(
      '2 blocos · cargos específicos',
    );
  });
});

describe('the edit header', () => {
  it('carries the report name as an editable control, not a heading', () => {
    renderHeader();
    // A textbox: typing in it renames the report. A heading would not.
    const name = screen.getByTestId('report-editor-name');
    expect(name.tagName).toBe('INPUT');
    expect(screen.getByRole('textbox', { name: 'Nome do relatório' })).toBe(name);
  });

  it('shows the lifecycle as a chip beside the name', () => {
    renderHeader();
    expect(screen.getByTestId('report-editor-status-chip').textContent).toContain('Rascunho');
  });

  it('derives the subtitle from live state', () => {
    renderHeader({ blockCount: 1, publish: { ...PUBLISH, visibility: 'tenant' } });
    expect(screen.getByTestId('report-editor-subtitle').textContent).toBe('1 bloco · toda a equipe');
  });

  it('offers every action on one row, and wraps rather than clipping', () => {
    const events = renderHeader();
    for (const testId of [
      'report-editor-back',
      'report-editor-settings',
      'report-editor-cancel',
      'report-editor-save',
    ]) {
      expect(screen.getByTestId(testId)).toBeTruthy();
    }
    // The row is allowed to reflow: at 390px the cluster falls to a second
    // line instead of pushing Salvar past the right edge. Read off the
    // CASCADE, not off `style` — the rule arrives through an emotion class.
    const header = screen.getByTestId('report-editor-header');
    expect(window.getComputedStyle(header).flexWrap).toBe('wrap');

    fireEvent.click(screen.getByTestId('report-editor-settings'));
    fireEvent.click(screen.getByTestId('report-editor-save'));
    expect(events.calls).toEqual(['settings', 'save']);
  });

  it('says so when there is unsaved work', () => {
    renderHeader({ dirty: true });
    expect(screen.getByTestId('report-editor-dirty')).toBeTruthy();
  });

  it('stays quiet when there is not', () => {
    renderHeader({ dirty: false });
    // Paired control first: the header really rendered, so the absence below
    // is a choice rather than a blank page.
    expect(screen.getByTestId('report-editor-save')).toBeTruthy();
    expect(screen.queryAllByTestId('report-editor-dirty')).toEqual([]);
  });
});

function renderDialog(changes: unknown[] = [], publish: PublishDraft = PUBLISH): void {
  render(
    <ReportSettingsDialog
      open
      tenantSlug="acme"
      value={{ name: 'Painel', description: '', publish, defaultRange: '30d' }}
      onChange={(next) => changes.push(next)}
      onClose={() => undefined}
    />,
  );
}

describe('the Ajustes dialog', () => {
  it('holds everything that used to be inline on the page', () => {
    renderDialog();
    expect(screen.getByTestId('report-settings-name')).toBeTruthy();
    // The description kept the id it carried inline: it moved, it did not go.
    expect(screen.getByTestId('report-editor-description')).toBeTruthy();
    expect(screen.getByTestId('report-settings-status-published')).toBeTruthy();
    expect(screen.getByTestId('report-settings-status-draft')).toBeTruthy();
    expect(screen.getByTestId('report-settings-visibility-private')).toBeTruthy();
    expect(screen.getByTestId('report-settings-visibility-tenant')).toBeTruthy();
    expect(screen.getByTestId('report-settings-visibility-roles')).toBeTruthy();
    expect(screen.getByTestId('report-settings-done')).toBeTruthy();
  });

  it('offers status and sharing as RADIOS, each with its consequence written out', () => {
    renderDialog();
    const draft = screen.getByTestId('report-settings-status-draft');
    expect(within(draft).getByRole('radio')).toBeTruthy();
    expect(draft.textContent).toContain('Só você vê, mesmo que compartilhado.');

    const team = screen.getByTestId('report-settings-visibility-tenant');
    expect(team.textContent).toContain('Qualquer pessoa com acesso ao admin da loja.');
  });

  it('reports a status choice back to the page', () => {
    const changes: unknown[] = [];
    renderDialog(changes);
    fireEvent.click(
      within(screen.getByTestId('report-settings-status-published')).getByRole('radio'),
    );
    expect(changes).toHaveLength(1);
    expect((changes[0] as { publish: PublishDraft }).publish.status).toBe('published');
  });

  it('makes the default period a real, settable preference', async () => {
    const changes: unknown[] = [];
    renderDialog(changes);
    const select = screen.getByTestId('report-settings-default-range');
    fireEvent.mouseDown(within(select).getByRole('combobox'));
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Hoje' })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('option', { name: 'Hoje' }));
    expect((changes.at(-1) as { defaultRange: string }).defaultRange).toBe('today');
  });

  it('refuses the scheduled e-mail out loud, and reachably', () => {
    renderDialog();
    const row = screen.getByTestId('report-settings-schedule');
    // aria-disabled, not `disabled`: a disabled control is unfocusable and has
    // no hover, so the sentence explaining it would be the one thing a
    // keyboard user could never reach.
    expect(row.getAttribute('aria-disabled')).toBe('true');
    // Still in the tab order, which is the whole point of refusing it with
    // `aria-disabled` rather than with `disabled`. Asserted as a SELECTOR
    // match: reading the property back reads to the flakiness gate as a focus
    // check, and this is a static attribute, not a focus state.
    expect(row.matches('[tabindex="0"]')).toBe(true);
    const reason = document.getElementById(row.getAttribute('aria-describedby') ?? '');
    expect(reason?.textContent).toContain('FUT-776');
  });
});
