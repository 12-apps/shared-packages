import { describe, expect, it } from 'vitest';

import { compileReport } from '../../compile';
import { reportCatalog } from '../catalog';
import { REPORT_ENTITY_STARTERS } from '../starters';

/**
 * FUT-308: every catalog entity ships a starter, and every starter compiles
 * against the LIVE catalog — a field rename that would break the builder's
 * prefill (or an MCP author copying it) fails here first.
 */
describe('REPORT_ENTITY_STARTERS', () => {
  it('covers every catalog entity', () => {
    expect(Object.keys(REPORT_ENTITY_STARTERS).sort()).toEqual(
      Object.keys(reportCatalog.entities).sort(),
    );
  });

  it('compiles each starter against the live catalog', () => {
    for (const [entity, starter] of Object.entries(REPORT_ENTITY_STARTERS)) {
      expect(starter.entity).toBe(entity);
      expect(() => compileReport(starter, reportCatalog)).not.toThrow();
    }
  });
});
