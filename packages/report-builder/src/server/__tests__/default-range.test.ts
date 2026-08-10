import { describe, expect, it } from 'vitest';

import { REPORT_RANGES } from '../../react/reports-api';
import { REPORT_DEFAULT_RANGES, REPORT_RANGE_PRESETS, resolveDefaultRange } from '../range';
import { saveReportBody } from '../wire';

/**
 * The period a saved report OPENS on (FUT-755).
 *
 * Three things have to agree or the feature silently half-works: the toggle the
 * author picks from, the values the wire accepts, and the values the DB CHECK
 * admits. The first two are pinned here; the third is the same list written
 * into `prisma/migrations/20260810120000_add_report_default_range`.
 */

describe('REPORT_DEFAULT_RANGES', () => {
  it('is exactly what the range toggle offers', () => {
    // A server list that drifted from the client's would refuse a value the
    // author could still choose — a 400 on a control that looks fine.
    expect([...REPORT_DEFAULT_RANGES]).toEqual([...REPORT_RANGES]);
  });

  it('does NOT admit `custom`', () => {
    // `custom` names an explicit from/to. A stored preference has nowhere to
    // keep those, so admitting it would store a window that resolves to
    // nothing the next time the report is opened.
    expect(REPORT_RANGE_PRESETS).toContain('custom');
    expect([...REPORT_DEFAULT_RANGES]).not.toContain('custom');
  });
});

describe('resolveDefaultRange', () => {
  it('returns a stored preset unchanged', () => {
    expect(resolveDefaultRange('today')).toBe('today');
    expect(resolveDefaultRange('7d')).toBe('7d');
  });

  it('falls back to 30d for a row that has no preference', () => {
    // Every row written before the column existed — the reader must show them
    // exactly what they always showed.
    expect(resolveDefaultRange(null)).toBe('30d');
    expect(resolveDefaultRange(undefined)).toBe('30d');
  });

  it('falls back for a value the reader cannot use', () => {
    // The DB CHECK makes this unreachable through our own writes; it is here
    // because "unreadable preference" must degrade to a working report rather
    // than to a report that opens on nothing.
    expect(resolveDefaultRange('custom')).toBe('30d');
    expect(resolveDefaultRange('ontem')).toBe('30d');
  });
});

describe('saveReportBody', () => {
  const base = {
    name: 'Painel',
    spec: {
      entity: 'orders',
      measures: [{ field: 'revenueCents', aggregation: 'sum' as const }],
    },
  };

  it('accepts a preset', () => {
    const parsed = saveReportBody.parse({ ...base, defaultRange: '7d' });
    expect(parsed.defaultRange).toBe('7d');
  });

  it('accepts null, which clears the preference', () => {
    expect(saveReportBody.parse({ ...base, defaultRange: null }).defaultRange).toBeNull();
  });

  it('treats an omitted value as "keep whatever is stored"', () => {
    expect(saveReportBody.parse(base).defaultRange).toBeUndefined();
  });

  it('refuses a value the reader could not resolve', () => {
    // Validated at the wire as well as by the DB CHECK, because this body is
    // written by MCP authors too — not only by our own form.
    expect(saveReportBody.safeParse({ ...base, defaultRange: 'custom' }).success).toBe(false);
    expect(saveReportBody.safeParse({ ...base, defaultRange: 'sempre' }).success).toBe(false);
  });
});
