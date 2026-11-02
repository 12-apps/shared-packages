import Box from '@mui/material/Box/index.js';
import type * as React from 'react';

import { SR_ONLY_SX } from '../ScheduleGrid/ScheduleGrid.styles';
import type { RulerScale } from './DayRuler.keyboard';
import { coverageLabelSx, coverageSx, lineSx } from './DayRuler.styles';
import { footerCellSx, footerNoteSx, trendSx } from './DayRuler.footer.styles';
import type { DayRulerFooterCell, DayRulerFooterRow, RulerHour } from './DayRuler.types';
import { formatHour } from './day-ruler-model';

/** The points of a trend over the hours' centres, in a 100 × 40 box: the highest value near the top, `null` breaks nothing (it is skipped). */
export function trendPoints(values: readonly (number | null)[], hours: number): string {
  const present = values.slice(0, hours).filter((value): value is number => value !== null);
  const max = Math.max(0, ...present);
  return values
    .slice(0, hours)
    .flatMap((value, index) => {
      if (value === null) return [];
      const x = ((index + 0.5) * 100) / hours;
      const y = max > 0 ? 38 - (value / max) * 34 : 38;
      return [`${x.toFixed(2)},${y.toFixed(2)}`];
    })
    .join(' ');
}

/** One hour's default words: "20:00 · 4"; just the hour when it says nothing. */
const hourWords = (hour: RulerHour, text: string): string => (text ? `${formatHour(hour)} · ${text}` : formatHour(hour));

/** What a reader hears for a marked hour: the host's `title`, else the hour, its count and that it is short. */
function markedWords(cell: DayRulerFooterCell, hour: RulerHour, marked: string): string {
  return cell.title ?? `${hourWords(hour, cell.text)} · ${marked}`;
}

interface FooterContext {
  hours: number;
  from: RulerHour;
  /** `labels.footerMarked`. */
  marked: string;
}

function FooterCells({ cells, ctx }: { cells: readonly DayRulerFooterCell[]; ctx: FooterContext }): React.JSX.Element {
  return (
    <Box sx={coverageSx(ctx.hours)}>
      {Array.from({ length: ctx.hours }, (_, index) => {
        const cell = cells[index] ?? { text: '' };
        const hour = ctx.from + index;
        return (
          <Box
            key={index}
            component="span"
            sx={footerCellSx(Boolean(cell.marked))}
            title={cell.marked ? markedWords(cell, hour, ctx.marked) : (cell.title ?? hourWords(hour, cell.text))}
            data-marked={cell.marked ? '' : undefined}
          >
            {/* A marked hour is said in words too, not only by its outline and a tooltip touch never shows. */}
            {cell.marked ? (
              <>
                <span aria-hidden>{cell.text}</span>
                <Box component="span" sx={SR_ONLY_SX}>
                  {markedWords(cell, hour, ctx.marked)}
                </Box>
              </>
            ) : (
              cell.text
            )}
          </Box>
        );
      })}
    </Box>
  );
}

/** A trend's figures in words, for the reader the drawn line does not reach: "11:00 4 · 12:00 6". */
function trendWords(values: readonly (number | null)[], ctx: FooterContext): string {
  return values
    .slice(0, ctx.hours)
    .flatMap((value, index) => (value === null ? [] : [`${formatHour(ctx.from + index)} ${Math.round(value * 10) / 10}`]))
    .join(' · ');
}

function FooterFigures({ row, ctx }: { row: DayRulerFooterRow; ctx: FooterContext }): React.JSX.Element {
  if (row.trend) {
    return (
      <Box component="span" sx={{ display: 'block', minWidth: 0 }}>
        <Box component="svg" viewBox="0 0 100 40" preserveAspectRatio="none" sx={trendSx} aria-hidden>
          <polyline fill="none" stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke" points={trendPoints(row.trend, ctx.hours)} />
        </Box>
        <Box component="span" sx={SR_ONLY_SX}>
          {trendWords(row.trend, ctx)}
        </Box>
      </Box>
    );
  }
  if (row.note !== undefined) {
    return (
      <Box component="span" sx={footerNoteSx(Boolean(row.marked))} data-marked={row.marked ? '' : undefined}>
        {row.note}
      </Box>
    );
  }
  return <FooterCells cells={row.cells ?? []} ctx={ctx} />;
}

/**
 * A group's lines under its rows (FUT-3882): counts per hour, a trend, or a
 * sentence, on the tracks' columns. `marked` is `labels.footerMarked`.
 */
export function GroupFooter(props: { rows: readonly DayRulerFooterRow[]; scale: RulerScale; testId: string; marked: string }): React.JSX.Element {
  const { rows, scale, testId } = props;
  const ctx: FooterContext = { hours: scale.to - scale.from, from: scale.from, marked: props.marked };
  return (
    <>
      {rows.map((row) => (
        <Box key={row.id} sx={lineSx} data-testid={`${testId}-footer-${row.id}`}>
          <Box component="span" sx={coverageLabelSx}>
            {row.label}
          </Box>
          <FooterFigures row={row} ctx={ctx} />
        </Box>
      ))}
    </>
  );
}
