import { describe, expect, it } from 'vitest';

import type {
  ReportEntityFields,
  ReportSpecWire,
  SavedReportSummary,
  SavedReportView,
} from '../custom-reports-api';
import {
  addBlock,
  documentFromDraft,
  draftFromDocument,
  emptyReportDraft,
  moveBlock,
  removeBlock,
  reorderBlock,
  selectReportOptions,
  starterBlockSpec,
  updateBlock,
  updateBlockSpec,
  viewBlocks,
  type ReportDraft,
} from '../report-model';

const TABLE_SPEC: ReportSpecWire = {
  entity: 'orders',
  dimensions: [{ field: 'method' }],
  measures: [{ field: 'revenueCents', aggregation: 'sum' }],
  filters: [],
  sort: [],
  presentation: { kind: 'table' },
};

const KPI_SPEC: ReportSpecWire = { ...TABLE_SPEC, dimensions: [], presentation: { kind: 'kpi' } };

function draftWith(ids: string[]): ReportDraft {
  return {
    name: 'Painel',
    description: '',
    blocks: ids.map((id) => ({ id, title: '', span: 6, spec: TABLE_SPEC })),
  };
}

const order = (draft: ReportDraft): string[] => draft.blocks.map((block) => block.id);

describe('addBlock', () => {
  it('appends a block with a fresh id at a width its presentation can render', () => {
    const one = addBlock(emptyReportDraft(), TABLE_SPEC, 'Vendas');
    expect(one.blocks).toHaveLength(1);
    expect(one.blocks[0]?.id).toBe('bloco-1');
    expect(one.blocks[0]?.title).toBe('Vendas');
    // The FIRST block fills the canvas — see the suite below.
    expect(one.blocks[0]?.span).toBe(12);

    const two = addBlock(one, KPI_SPEC, 'Receita');
    expect(order(two)).toEqual(['bloco-1', 'bloco-2']);
  });

  it('never reuses an id already on the canvas', () => {
    const draft = addBlock(draftWith(['bloco-1', 'bloco-2']), TABLE_SPEC, 'Terceiro');
    expect(new Set(order(draft)).size).toBe(3);
  });
});

describe('updateBlock', () => {
  it('applies the patch and clamps a width the presentation cannot render', () => {
    const draft = updateBlock(draftWith(['a']), 'a', { title: 'Receita', span: 2 });
    expect(draft.blocks[0]?.title).toBe('Receita');
    // A table asked for 2 columns lands on its floor (6) instead.
    expect(draft.blocks[0]?.span).toBe(6);
  });

  it('leaves other blocks untouched', () => {
    const draft = updateBlock(draftWith(['a', 'b']), 'a', { span: 12 });
    expect(draft.blocks[1]?.span).toBe(6);
  });
});

describe('updateBlockSpec', () => {
  it('swaps the query and re-fits the width to the new presentation', () => {
    const narrow: ReportDraft = {
      ...draftWith(['a']),
      blocks: [{ id: 'a', title: '', span: 3, spec: KPI_SPEC }],
    };
    const widened = updateBlockSpec(narrow, 'a', TABLE_SPEC);
    expect(widened.blocks[0]?.spec.presentation).toEqual({ kind: 'table' });
    expect(widened.blocks[0]?.span).toBe(6);
  });

  it('keeps a width that already fits', () => {
    const draft = updateBlockSpec(draftWith(['a']), 'a', KPI_SPEC);
    expect(draft.blocks[0]?.span).toBe(6);
  });
});

describe('removeBlock', () => {
  it('drops only the named block', () => {
    expect(order(removeBlock(draftWith(['a', 'b', 'c']), 'b'))).toEqual(['a', 'c']);
  });
});

/** FUT-311: drag-and-drop drops the source into the target's position. */
describe('reorderBlock', () => {
  it('moves the source block to the target position in both directions', () => {
    const draft = draftWith(['a', 'b', 'c', 'd']);
    expect(order(reorderBlock(draft, 'a', 'c'))).toEqual(['b', 'c', 'a', 'd']);
    expect(order(reorderBlock(draft, 'd', 'b'))).toEqual(['a', 'd', 'b', 'c']);
  });

  it('ignores unknown ids and self-drops', () => {
    const draft = draftWith(['a', 'b']);
    expect(reorderBlock(draft, 'a', 'missing')).toBe(draft);
    expect(reorderBlock(draft, 'missing', 'a')).toBe(draft);
    expect(reorderBlock(draft, 'a', 'a')).toBe(draft);
  });
});

describe('moveBlock', () => {
  it('moves one step and clamps at the edges', () => {
    const draft = draftWith(['a', 'b', 'c']);
    expect(order(moveBlock(draft, 'b', -1))).toEqual(['b', 'a', 'c']);
    expect(order(moveBlock(draft, 'c', 1))).toEqual(['a', 'b', 'c']);
    expect(order(moveBlock(draft, 'a', -1))).toEqual(['a', 'b', 'c']);
  });
});

describe('documentFromDraft', () => {
  it('always emits the multi-block document, dropping blank titles', () => {
    const draft = updateBlock(draftWith(['a', 'b']), 'a', { title: '  Receita  ' });
    const document = documentFromDraft(draft);
    expect(document.kind).toBe('dashboard');
    expect(document.blocks[0]?.title).toBe('Receita');
    expect(document.blocks[1]).not.toHaveProperty('title');
  });
});

describe('draftFromDocument', () => {
  it('round-trips a multi-block document', () => {
    const document = documentFromDraft(draftWith(['a', 'b']));
    const draft = draftFromDocument('Painel', null, document);
    expect(order(draft)).toEqual(['a', 'b']);
    expect(draft.description).toBe('');
  });

  it('opens a legacy single-spec report as one full-width block', () => {
    const draft = draftFromDocument('Antigo', 'desc', TABLE_SPEC);
    expect(draft.blocks).toHaveLength(1);
    expect(draft.blocks[0]?.span).toBe(12);
    expect(draft.blocks[0]?.spec).toEqual(TABLE_SPEC);
    // …and saving it back produces a regular multi-block document.
    expect(documentFromDraft(draft).kind).toBe('dashboard');
  });

  it('re-fits a stored width that its presentation cannot render', () => {
    const draft = draftFromDocument('Painel', null, {
      kind: 'dashboard',
      blocks: [{ id: 'a', span: 3, spec: TABLE_SPEC }],
    });
    expect(draft.blocks[0]?.span).toBe(6);
  });
});

/**
 * `Altura` travels the way `span` does (FUT-755) — with ONE difference that is
 * the entire compatibility story: it is optional, so a block that has never
 * been given a height carries none, saves none, and is therefore as tall as
 * its content exactly as it has always been.
 */
describe('height — a block with none must stay a block with none', () => {
  it('adds a new block with no height at all', () => {
    const draft = addBlock(emptyReportDraft(), TABLE_SPEC, 'Vendas');
    expect(draft.blocks[0]?.height).toBeUndefined();
  });

  it('OMITS the key from the saved document rather than writing a default', () => {
    // A document that has always been content-height has to stay byte-identical
    // — a `height: 1` written on save would resize every stored report.
    const document = documentFromDraft(draftWith(['a', 'b']));
    expect(document.blocks[0]).not.toHaveProperty('height');
    expect(document.blocks[1]).not.toHaveProperty('height');
  });

  it('reads a stored document with no heights back as no heights', () => {
    const draft = draftFromDocument('Painel', null, {
      kind: 'dashboard',
      blocks: [{ id: 'a', span: 6, spec: TABLE_SPEC }],
    });
    expect(draft.blocks[0]?.height).toBeUndefined();
  });

  it('keeps a legacy single-spec report content-height too', () => {
    expect(draftFromDocument('Antigo', 'desc', TABLE_SPEC).blocks[0]?.height).toBeUndefined();
  });

  it('leaves height alone when some OTHER property of the block changes', () => {
    const draft = updateBlock(draftWith(['a']), 'a', { title: 'Receita' });
    expect(draft.blocks[0]?.height).toBeUndefined();
    expect(documentFromDraft(draft).blocks[0]).not.toHaveProperty('height');
  });
});

/**
 * The width a new block starts at (FUT-755).
 *
 * With `flexGrow` set to the span, a block alone on its row absorbed the rest
 * of it — so a report's first block filled the canvas whatever number was
 * stored under it. Now that a span is rendered literally the default has to say
 * that itself, or a brand-new report opens as a half-width chart with a hole
 * beside it.
 */
describe('addBlock — the first block fills the canvas', () => {
  it('gives the first block the whole canvas and the next one a half', () => {
    const one = addBlock(emptyReportDraft(), TABLE_SPEC, 'A');
    expect(one.blocks[0]?.span).toBe(12);
    const two = addBlock(one, TABLE_SPEC, 'B');
    expect(two.blocks[1]?.span).toBe(6);
  });

  it('never gives a Número the whole canvas, first or not', () => {
    // Its own widths stop at a half: past that a single figure is a lonely
    // number on a banner, which is what narrowed the KPI set to begin with.
    expect(addBlock(emptyReportDraft(), KPI_SPEC, 'A').blocks[0]?.span).toBe(6);
  });
});

describe('height — once chosen, it round-trips', () => {
  it('stores a chosen height and reads it back', () => {
    const draft = updateBlock(draftWith(['a']), 'a', { height: 3 });
    expect(draft.blocks[0]?.height).toBe(3);
    const document = documentFromDraft(draft);
    expect(document.blocks[0]?.height).toBe(3);
    expect(draftFromDocument('Painel', null, document).blocks[0]?.height).toBe(3);
  });

  it('keeps the shortest tier for any presentation — no height is ever refused', () => {
    // NOT the mirror of the width case above. A narrow block TRUNCATES, so a
    // width has a floor per presentation; a short one merely outgrows its tier,
    // and every tier is tall enough to read at. A tier an author cannot choose
    // makes the whole set look broken.
    const draft = draftFromDocument('Painel', null, {
      kind: 'dashboard',
      blocks: [{ id: 'a', span: 6, height: 1, spec: TABLE_SPEC }],
    });
    expect(draft.blocks[0]?.height).toBe(1);
  });

  it('leaves the height alone when the PRESENTATION changes under it', () => {
    // The width IS re-fitted here (a table needs six columns). The height is
    // not, because there is no floor to re-fit it to.
    const kpi = updateBlock(
      { name: 'P', description: '', blocks: [{ id: 'a', title: '', span: 6, spec: KPI_SPEC }] },
      'a',
      { height: 1 },
    );
    expect(kpi.blocks[0]?.height).toBe(1);
    expect(updateBlockSpec(kpi, 'a', TABLE_SPEC).blocks[0]?.height).toBe(1);
  });

  it('clamps a stored height outside the three tiers instead of failing to open', () => {
    const draft = draftFromDocument('Painel', null, {
      kind: 'dashboard',
      blocks: [{ id: 'a', span: 6, height: 9, spec: TABLE_SPEC }],
    });
    expect(draft.blocks[0]?.height).toBe(3);
  });

  it('does not invent a height when the presentation changes under a block without one', () => {
    const draft = updateBlockSpec(draftWith(['a']), 'a', KPI_SPEC);
    expect(draft.blocks[0]?.height).toBeUndefined();
  });

  it('clears back to content height when the author picks Auto', () => {
    const chosen = updateBlock(draftWith(['a']), 'a', { height: 3 });
    const cleared = updateBlock(chosen, 'a', { height: undefined });
    expect(cleared.blocks[0]?.height).toBeUndefined();
    expect(documentFromDraft(cleared).blocks[0]).not.toHaveProperty('height');
  });
});

describe('viewBlocks', () => {
  const base = {
    id: 'r1',
    name: 'R',
    description: null,
    status: 'published' as const,
    visibility: 'tenant' as const,
    visibilityRoles: [],
    range: { preset: '30d', from: '', toExclusive: '' },
  };

  it('passes a multi-block report through untouched', () => {
    const view: SavedReportView = {
      ...base,
      type: 'dashboard',
      spec: { kind: 'dashboard', blocks: [] },
      blocks: [{ id: 'a', span: 4, status: 'ok', render: { kind: 'table', columns: [], rows: [] } }],
    };
    expect(viewBlocks(view).map((block) => block.id)).toEqual(['a']);
  });

  it('wraps a legacy single report so the viewer has one grid to draw', () => {
    const view: SavedReportView = {
      ...base,
      type: 'report',
      spec: TABLE_SPEC,
      render: { kind: 'table', columns: [], rows: [] },
    };
    const blocks = viewBlocks(view);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.span).toBe(12);
  });
});

describe('starterBlockSpec', () => {
  const entity: ReportEntityFields = {
    entity: 'orders',
    label: 'Pedidos',
    fields: [
      { field: 'method', label: 'Forma', type: 'string', role: 'dimension' },
      { field: 'revenueCents', label: 'Receita', type: 'money', role: 'measure' },
    ],
    starter: {
      entity: 'orders',
      dimensions: [{ field: 'method' }],
      measures: [{ field: 'revenueCents', aggregation: 'sum' }],
      filters: [],
      sort: [],
      presentation: { kind: 'chart', chartType: 'bar' },
    },
  };

  it("starts from the entity's known-good starter, so a new block renders at once", () => {
    const spec = starterBlockSpec(entity);
    expect(spec.entity).toBe('orders');
    expect(spec.measures).toHaveLength(1);
    expect(spec.presentation).toMatchObject({ kind: 'chart', chartType: 'bar' });
  });

  it('still yields a RUNNABLE spec for an entity with no starter', () => {
    const withoutStarter: ReportEntityFields = { ...entity };
    delete withoutStarter.starter;
    const spec = starterBlockSpec(withoutStarter);
    // A spec with zero measures is rejected by the compiler — never emit one.
    expect(spec.measures.length).toBeGreaterThan(0);
    expect(spec.entity).toBe('orders');
  });
});

describe('selectReportOptions', () => {
  const report = (id: string, status: SavedReportSummary['status']): SavedReportSummary => ({
    id,
    name: id,
    description: null,
    type: 'dashboard',
    entity: '',
    entities: ['orders'],
    blockCount: 2,
    status,
    visibility: 'tenant',
    ownedByMe: true,
    updatedAt: '2026-07-27T00:00:00.000Z',
  });
  const reports = [report('live', 'published'), report('wip', 'draft'), report('old', 'archived')];

  it('hides archived reports and lands on the first live one', () => {
    const picker = selectReportOptions(reports, false, undefined);
    expect(picker.options.map((option) => option.id)).toEqual(['live', 'wip']);
    expect(picker.selectedId).toBe('live');
  });

  it('shows only archived reports when asked', () => {
    const picker = selectReportOptions(reports, true, undefined);
    expect(picker.options.map((option) => option.id)).toEqual(['old']);
    expect(picker.selectedId).toBe('old');
  });

  it('keeps a deep-linked archived report open instead of swapping it out', () => {
    const picker = selectReportOptions(reports, false, 'old');
    expect(picker.selectedId).toBe('old');
    expect(picker.options.map((option) => option.id)).toContain('old');
  });

  it('falls back to the first option when the requested id is not visible', () => {
    expect(selectReportOptions(reports, false, 'gone').selectedId).toBe('live');
    expect(selectReportOptions([], false, undefined).selectedId).toBe('');
  });
});
