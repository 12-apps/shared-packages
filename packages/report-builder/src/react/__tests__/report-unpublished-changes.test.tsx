// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { SavedReportSummary, SavedReportView } from '../custom-reports-api';
import { ReportCard, reportCardChip } from '../report-card';
import { editorSource } from '../report-editor-source';
import { UnpublishedChangesBar } from '../report-editor-unpublished';
import type { UnpublishedChanges } from '../report-editor-state';

/**
 * "If I started editing it save a draft version" (FUT-755), at the surface.
 *
 * The one distinction every case here defends: `status: 'draft'` means the
 * report was NEVER published, while unpublished CHANGES belong to a report that
 * is live and being edited. Collapsing them would tell a reader their published
 * report had been taken down, which is a worse outcome than the lost edit the
 * feature exists to prevent.
 */

const SPEC = {
  entity: 'orders',
  dimensions: [{ field: 'method' }],
  measures: [{ field: 'totalCents' }],
  filters: [],
  sort: [],
  presentation: { kind: 'table' as const },
};

const EDITED_SPEC = { ...SPEC, dimensions: [{ field: 'createdAt' }] };

const NOW = new Date('2026-08-10T12:00:00.000Z');

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
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  window.matchMedia = realMatchMedia;
});

function summary(patch: Partial<SavedReportSummary> = {}): SavedReportSummary {
  return {
    id: 'r1',
    name: 'Vendas por dia',
    description: null,
    type: 'dashboard',
    entity: '',
    entities: ['orders'],
    blockCount: 3,
    status: 'published',
    visibility: 'tenant',
    ownedByMe: true,
    hasUnpublishedChanges: false,
    updatedAt: NOW.toISOString(),
    ...patch,
  } as SavedReportSummary;
}

function view(patch: Partial<SavedReportView> = {}): SavedReportView {
  return {
    type: 'dashboard',
    id: 'r1',
    name: 'Vendas',
    description: 'Receita da loja',
    status: 'published',
    visibility: 'tenant',
    visibilityRoles: [],
    defaultRange: '7d',
    spec: { kind: 'dashboard', blocks: [{ id: 'bloco-1', span: 12, spec: SPEC }] },
    blocks: [],
    range: { preset: '7d', from: '2026-08-03', toExclusive: '2026-08-10' },
    ...patch,
  } as SavedReportView;
}

describe('which chip a report card carries', () => {
  it('says Rascunho for a report that was never published', () => {
    expect(reportCardChip(summary({ status: 'draft' }))?.label).toBe('Rascunho');
  });

  it('says Arquivado once it is retired', () => {
    expect(reportCardChip(summary({ status: 'archived' }))?.label).toBe('Arquivado');
  });

  /** The state this feature added, and the one it must not be confused with. */
  it('says Alterações não publicadas for a LIVE report being edited', () => {
    const chip = reportCardChip(summary({ hasUnpublishedChanges: true }));
    expect(chip?.label).toBe('Alterações não publicadas');
    // Never the draft word: this report has not been taken down.
    expect(chip?.label).not.toContain('Rascunho');
  });

  /**
   * A never-published report has no published version for changes to be
   * unpublished RELATIVE to, so the lifecycle claim wins the single chip slot.
   */
  it('keeps saying Rascunho when a never-published report is also being edited', () => {
    expect(reportCardChip(summary({ status: 'draft', hasUnpublishedChanges: true }))?.label).toBe(
      'Rascunho',
    );
  });

  it('says nothing about a published report nobody is editing', () => {
    expect(reportCardChip(summary())).toBeNull();
  });

  it('reads as none when the field is missing from a cached response', () => {
    const cached = summary();
    delete (cached as { hasUnpublishedChanges?: boolean }).hasUnpublishedChanges;
    expect(reportCardChip(cached)).toBeNull();
  });

  it('renders the chip on the card itself', () => {
    render(
      <ReportCard
        report={summary({ hasUnpublishedChanges: true })}
        now={NOW}
        onSelect={() => undefined}
        onEdit={() => undefined}
        onArchive={() => undefined}
      />,
    );

    expect(screen.getByText('Alterações não publicadas')).toBeTruthy();
    expect(screen.getByText('Vendas por dia')).toBeTruthy();
  });
});

describe('what the editor opens on', () => {
  /** Reopening resumes the parked edit — the whole point of storing one. */
  it('resumes the parked edit rather than the published document', () => {
    const source = editorSource(
      view({
        workingCopy: {
          name: 'Vendas por dia',
          spec: { kind: 'dashboard', blocks: [{ id: 'bloco-1', span: 12, spec: EDITED_SPEC }] },
        },
      }),
    );

    expect(source.initial.draft.name).toBe('Vendas por dia');
    expect(source.initial.draft.blocks[0]?.spec.dimensions[0]?.field).toBe('createdAt');
    expect(source.hasUnpublishedChanges).toBe(true);
    // And the published version is carried along, because discarding has to
    // have somewhere to land.
    expect(source.published.draft.name).toBe('Vendas');
    expect(source.published.draft.blocks[0]?.spec.dimensions[0]?.field).toBe('method');
  });

  it('opens on the stored document when nothing is parked', () => {
    const source = editorSource(view());

    expect(source.initial.draft.name).toBe('Vendas');
    expect(source.hasUnpublishedChanges).toBe(false);
  });

  /**
   * Only a published report has readers to protect. Editing a never-published
   * draft simply saves — the ask is explicit that nothing about that changes.
   */
  it('parks edits only for a published report', () => {
    expect(editorSource(view()).parksEdits).toBe(true);
    expect(editorSource(view({ status: 'draft' })).parksEdits).toBe(false);
    expect(editorSource(view({ status: 'archived' })).parksEdits).toBe(false);
    expect(editorSource(undefined).parksEdits).toBe(false);
  });

  /** A working copy written before a field existed resumes on the report's own. */
  it('falls back to the published values for anything the parked edit omits', () => {
    const source = editorSource(
      view({
        visibility: 'private',
        defaultRange: '7d',
        workingCopy: {
          name: 'Vendas',
          spec: { kind: 'dashboard', blocks: [{ id: 'bloco-1', span: 12, spec: SPEC }] },
        },
      }),
    );

    expect(source.initial.publish.visibility).toBe('private');
    expect(source.initial.defaultRange).toBe('7d');
  });
});

const STRIP_SELECTOR = '[data-testid="report-editor-unpublished"]';

/** What a click did, collected on a container rather than a rebound binding. */
function recorder(): { calls: string[]; unpublished: UnpublishedChanges } {
  const calls: string[] = [];
  return {
    calls,
    unpublished: {
      present: true,
      autosave: 'idle',
      discarding: false,
      discard: () => calls.push('discard'),
    },
  };
}

describe('the editor tells the author about unpublished changes', () => {
  /**
   * Both halves in one case on purpose: an absence assertion on its own passes
   * against a component that renders nothing ever, which is the failure mode a
   * "does not show" test is most likely to have.
   */
  it('appears only when there is something unpublished', () => {
    const events = recorder();
    const quiet = render(
      <UnpublishedChangesBar unpublished={{ ...events.unpublished, present: false }} />,
    );
    expect(quiet.container.querySelectorAll(STRIP_SELECTOR)).toHaveLength(0);

    quiet.rerender(<UnpublishedChangesBar unpublished={events.unpublished} />);
    expect(quiet.container.querySelectorAll(STRIP_SELECTOR)).toHaveLength(1);
  });

  it('says what readers are seeing, and how to publish', () => {
    const events = recorder();
    render(<UnpublishedChangesBar unpublished={events.unpublished} />);

    expect(screen.getByTestId('report-editor-unpublished')).toBeTruthy();
    expect(screen.getByText('Alterações não publicadas')).toBeTruthy();
    // The consequence, spelled out: the report did NOT come down.
    expect(screen.getByText(/continua vendo a versão publicada/)).toBeTruthy();
    expect(screen.getByText(/Salve para publicar/)).toBeTruthy();
  });

  /** Discard throws work away, so it goes through the area's one confirmation. */
  it('confirms before discarding', async () => {
    const events = recorder();
    render(
      <MemoryRouter>
        <UnpublishedChangesBar unpublished={events.unpublished} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId('report-editor-discard-changes'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Descartar alterações' })).toBeTruthy();
    });
    // Nothing has happened yet — the dialog is the whole point.
    expect(events.calls).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => {
      expect(events.calls).toEqual([]);
    });
  });

  it('discards once the author confirms', async () => {
    const events = recorder();
    render(
      <MemoryRouter>
        <UnpublishedChangesBar unpublished={events.unpublished} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId('report-editor-discard-changes'));
    // The modal takes the accessibility tree with it, so the only button under
    // this name is the dialog's own confirm — the strip's trigger behind it is
    // `aria-hidden` while the question is on screen.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Descartar alterações' })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Descartar alterações' }));

    await waitFor(() => {
      expect(events.calls).toEqual(['discard']);
    });
  });
});
