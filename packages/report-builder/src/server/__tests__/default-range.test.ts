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
 * into `prisma/migrations/20260810160000_report_default_range_month`.
 */

describe('REPORT_DEFAULT_RANGES', () => {
  it('is exactly the toggle’s presets, minus `custom`', () => {
    // RESTATED (FUT-755). This asserted plain equality with `REPORT_RANGES`,
    // which held only while every preset the toggle offered was also storable.
    // It now offers `Personalizado…` as well, so the two lists differ by one
    // entry BY DESIGN and the old equality fails for the right reason — but
    // deleting it would leave nothing pinning the other four.
    //
    // So the rule the equality stood in for is stated directly: the defaults
    // ARE the toggle's presets minus `custom`. Deliberately not relaxed to
    // "every default is also a preset" — a subset check passes while the two
    // drift, which is the exact silent half-working this file exists to catch:
    // add `month` to the toggle, forget the store, and the author picks a
    // default the save then refuses with a 400 from a control that looked fine.
    expect([...REPORT_DEFAULT_RANGES]).toEqual(
      REPORT_RANGES.filter((preset) => preset !== 'custom'),
    );
  });

  it('does NOT admit `custom`', () => {
    // `custom` names an explicit from/to. A stored preference has nowhere to
    // keep those, so admitting it would store a window that resolves to
    // nothing the next time the report is opened.
    expect(REPORT_RANGE_PRESETS).toContain('custom');
    expect([...REPORT_DEFAULT_RANGES]).not.toContain('custom');
  });

  it('DOES admit `month`, which needs no dates to resolve', () => {
    // The other half of the same rule, and the half the migration had to
    // learn. Named explicitly so the trio — this list, the wire's `z.enum`,
    // the DB CHECK — has a failing test the day one is changed without the
    // others, rather than a 400 discovered from the settings dialog.
    expect([...REPORT_DEFAULT_RANGES]).toContain('month');
    expect(resolveDefaultRange('month')).toBe('month');
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

  it('accepts `month`, the preset the toggle grew (FUT-755)', () => {
    // The wire is the second of the three gates; a `z.enum` that had not
    // learned `month` would refuse the settings dialog's new option with a 400
    // while the list and the CHECK both allowed it.
    expect(saveReportBody.parse({ ...base, defaultRange: 'month' }).defaultRange).toBe('month');
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
