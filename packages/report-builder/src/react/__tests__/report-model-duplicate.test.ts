import { describe, expect, it } from 'vitest';

import { addBlock, duplicateBlock, nextBlockId, type ReportDraft } from '../report-model';
import type { ReportSpecWire } from '../custom-reports-api';

/**
 * GAP 6 — *Duplicar* in the block's configuration panel.
 *
 * Two properties carry the whole feature, and both are easy to get wrong in a
 * way no screenshot would show:
 *
 *  - the copy lands DIRECTLY AFTER its source. Appending it to the end reads
 *    as "nothing happened" on a canvas already a screen tall.
 *  - the copy is INDEPENDENT. A shallow `{...block}` shares one `spec` object
 *    between the two, and the configuration panel patches specs often enough
 *    that editing the copy would silently edit the original.
 */

function spec(field: string): ReportSpecWire {
  return {
    entity: 'orders',
    dimensions: [{ field }],
    measures: [{ field: 'revenueCents', aggregation: 'sum' }],
    filters: [],
    sort: [],
    presentation: { kind: 'table' },
  };
}

/** Three blocks, so "after its source" is distinguishable from "at the end". */
function draftOfThree(): ReportDraft {
  return ['Um', 'Dois', 'Três'].reduce<ReportDraft>(
    (draft, title) => addBlock(draft, spec('method'), title),
    { name: 'Painel', description: '', blocks: [] },
  );
}

describe('duplicateBlock', () => {
  it('puts the copy directly after its source, not at the end', () => {
    const draft = duplicateBlock(draftOfThree(), 'bloco-1');
    expect(draft.blocks.map((block) => block.title)).toEqual([
      'Um',
      'Um (cópia)',
      'Dois',
      'Três',
    ]);
  });

  it('gives the copy a fresh id', () => {
    const before = draftOfThree();
    const after = duplicateBlock(before, 'bloco-2');
    const ids = after.blocks.map((block) => block.id);
    expect(new Set(ids).size).toBe(ids.length);
    // And the id is the one the canvas predicted, which is how it knows what
    // to select and focus without diffing inside a state updater.
    expect(ids[2]).toBe(nextBlockId(before.blocks));
  });

  it('keeps the copy independent of its source', () => {
    const after = duplicateBlock(draftOfThree(), 'bloco-1');
    const source = after.blocks[0];
    const copy = after.blocks[1];
    expect(copy?.spec).toEqual(source?.spec);
    expect(copy?.spec).not.toBe(source?.spec);

    // Editing the copy's spec must not reach back into the original — the
    // failure a shallow copy produces, and the reason for the deep one.
    (copy?.spec.dimensions as Array<{ field: string }>).push({ field: 'status' });
    expect(source?.spec.dimensions).toHaveLength(1);
  });

  it('carries the width across, so the canvas does not reflow', () => {
    const before = draftOfThree();
    const widened = {
      ...before,
      blocks: before.blocks.map((block) =>
        block.id === 'bloco-1' ? { ...block, span: 12 } : block,
      ),
    };
    expect(duplicateBlock(widened, 'bloco-1').blocks[1]?.span).toBe(12);
  });

  it('is a no-op for an id the report does not have', () => {
    const before = draftOfThree();
    expect(duplicateBlock(before, 'bloco-99')).toEqual(before);
  });

  it('names an untitled block rather than producing " (cópia)"', () => {
    const draft = addBlock({ name: 'P', description: '', blocks: [] }, spec('method'), '');
    expect(duplicateBlock(draft, 'bloco-1').blocks[1]?.title).toBe('Bloco sem título (cópia)');
  });
});
