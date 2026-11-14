/**
 * FUT-4063, the contract's second round: a measure's declared precision, a
 * KPI's whole-period target flag, a table's phone cards (their aliases are
 * checked at compile), and the `week` preset's first day.
 */
import { describe, expect, it } from 'vitest';

import { defineCatalog } from '../catalog';
import { formatKpiFigure, formatReportValue } from '../format';
import { createMemoryDataSource } from '../memory';
import { PT_BR_REPORT_ENGINE_COPY } from '../pt-BR';
import { runReport } from '../run';
import { PT_BR_REPORT_SERVER_MESSAGES } from '../server/pt-BR';
import { resolveReportRange } from '../server/range';

const VALUES = PT_BR_REPORT_ENGINE_COPY.values;

describe('a measure declares its decimals', () => {
  it('prints whole reais, whole percents and whole hours at 0', () => {
    expect(formatReportValue(124_049, 'brl', VALUES, 0)).toBe('R$ 1.240');
    expect(formatReportValue(0.2549, 'percent', VALUES, 0)).toBe('25%');
    expect(formatReportValue(62.4 * 3600, 'duration', VALUES, 0)).toBe('62 h');
    expect(formatKpiFigure(0.2549, 'percent', 0)).toBe('25%');
  });

  it('keeps one decimal where asked, and every default byte-identical', () => {
    expect(formatReportValue(0.1149, 'percent', VALUES, 1)).toBe('11,5%');
    expect(formatReportValue(124_049, 'brl', VALUES)).toBe('R$ 1.240,49');
    expect(formatReportValue(0.2549, 'percent', VALUES)).toBe('25,5%');
    expect(formatReportValue(62.5 * 3600, 'duration', VALUES)).toBe('62h 30m');
  });
});

const catalog = defineCatalog({
  entities: {
    labour: {
      label: 'Horas',
      fields: {
        area: { label: 'Área', type: 'string', role: 'dimension' },
        costCents: { label: 'Custo', type: 'money', role: 'measure', aggregations: ['sum', 'ratio'] },
        salesCents: { label: 'Vendas', type: 'money', role: 'measure' },
      },
    },
  },
});

const options = {
  catalog,
  adapter: createMemoryDataSource(
    {
      labour: [
        { area: 'Cozinha', costCents: 441_000, salesCents: 1_000_000 },
        { area: 'Salão', costCents: 100_000, salesCents: 1_000_000 },
      ],
    },
    PT_BR_REPORT_ENGINE_COPY.labels.othersBucket,
  ),
  copy: PT_BR_REPORT_ENGINE_COPY,
};

const ratio = { field: 'costCents', aggregation: 'ratio' as const, denominator: 'salesCents', alias: 'ratio', format: 'percent' as const };

describe('the render model carries decimals only where declared', () => {
  it('puts decimals on the column that declared them and on no other', async () => {
    const { render } = await runReport(
      { entity: 'labour', dimensions: [{ field: 'area' }], measures: [{ field: 'costCents', alias: 'cost', decimals: 0 }, ratio] },
      options,
    );
    if (render.kind !== 'table') throw new Error('expected a table');
    expect(render.columns.find((column) => column.key === 'cost')).toMatchObject({ decimals: 0 });
    expect(render.columns.find((column) => column.key === 'ratio')).not.toHaveProperty('decimals');
  });
});

describe('a KPI flags the figure above its whole-period target', () => {
  const kpi = (above: number) => ({
    entity: 'labour',
    measures: [{ field: 'salesCents', alias: 'sales' }, ratio],
    presentation: { kind: 'kpi' as const, flag: { measure: 'ratio', above, label: 'acima da meta' } },
  });

  it('marks only that figure when the period is over', async () => {
    const { render } = await runReport(kpi(0.25), options);
    if (render.kind !== 'kpi') throw new Error('expected a kpi');
    // 541.000 / 2.000.000 = 27% > 25%.
    expect(render.figures[1]?.flag).toEqual({ label: 'acima da meta' });
    expect(render.figures[0]).not.toHaveProperty('flag');
  });

  it('marks nothing at or under the target, and nothing without a flag', async () => {
    const under = await runReport(kpi(0.3), options);
    if (under.render.kind !== 'kpi') throw new Error('expected a kpi');
    expect(under.render.figures.some((figure) => figure.flag)).toBe(false);
  });
});

describe('phone cards name columns of the spec', () => {
  it('passes the phone form through to the table model', async () => {
    const phone = { layout: 'cards' as const, figure: 'cost', subtitle: [{ measure: 'ratio', suffix: ' das vendas' }] };
    const { render } = await runReport(
      {
        entity: 'labour',
        dimensions: [{ field: 'area' }],
        measures: [{ field: 'costCents', alias: 'cost' }, ratio],
        presentation: { kind: 'table', phone },
      },
      options,
    );
    expect(render.kind === 'table' ? render.phone : undefined).toEqual(phone);
  });

  it('refuses a card naming a column the spec does not select', async () => {
    await expect(
      runReport(
        {
          entity: 'labour',
          dimensions: [{ field: 'area' }],
          measures: [ratio],
          presentation: { kind: 'table', phone: { layout: 'cards', figure: 'nope' } },
        },
        options,
      ),
    ).rejects.toThrow(/presentation\.phone names "nope"/);
  });
});

describe('the week preset opens on the configured first day', () => {
  // Saturday 14 Nov 2026, 15:00 in São Paulo.
  const SATURDAY = new Date('2026-11-14T18:00:00Z');
  const messages = PT_BR_REPORT_SERVER_MESSAGES.range;

  it('opens on Monday by default, week to date', () => {
    const range = resolveReportRange({ preset: 'week' }, SATURDAY, messages, 'America/Sao_Paulo');
    expect(range.from.toISOString()).toBe('2026-11-09T03:00:00.000Z');
    expect(range.toExclusive.toISOString()).toBe('2026-11-15T03:00:00.000Z');
  });

  it('opens on Sunday when the host says so', () => {
    const range = resolveReportRange({ preset: 'week' }, SATURDAY, messages, 'America/Sao_Paulo', 0);
    expect(range.from.toISOString()).toBe('2026-11-08T03:00:00.000Z');
  });
});
