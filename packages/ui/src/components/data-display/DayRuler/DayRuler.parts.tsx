import Box from '@mui/material/Box/index.js';
import type * as React from 'react';
import { useRef } from 'react';

import { ScheduleNameCell } from '../ScheduleGrid/ScheduleNameCell';
import type { RulerAbilities, RulerScale } from './DayRuler.keyboard';
import { DAY_RULER_METRICS as M } from './DayRuler.metrics';
import { useTextFits } from './useTextFits';
import { formatHour, formatRange, percentOf, ticksOf } from './day-ruler-model';
import {
  actionsSx,
  actualLabelSx,
  actualSx,
  axisSx,
  blockSx,
  breakSx,
  coverageCellSx,
  coverageLabelSx,
  coverageSx,
  footerCellSx,
  footerNoteSx,
  handleSx,
  lineSx,
  nowSx,
  rowSx,
  trackSx,
  trendSx,
  whoSx,
  type Span,
} from './DayRuler.styles';
import type { DayRulerBlock, DayRulerFooterCell, DayRulerFooterRow, DayRulerRow, RulerHour } from './DayRuler.types';
import type { RulerDrag, RulerDragApi } from './useRulerDrag';

export const spanOf = (start: RulerHour, end: RulerHour, scale: RulerScale): Span => {
  const at = percentOf(start, scale.from, scale.to);
  return { at, share: Math.max(0, percentOf(end, scale.from, scale.to) - at) };
};

/** What every row of one ruler shares. */
export interface RowContext {
  scale: RulerScale;
  now?: RulerHour;
  can: RulerAbilities;
  drag: RulerDrag | null;
  dragApi: RulerDragApi;
  onBlockClick?: (blockId: string) => void;
  onKeyCreate: (row: DayRulerRow) => void;
  onBlockKey: (event: React.KeyboardEvent, block: DayRulerBlock) => void;
  createLabel: (row: string) => string;
  testId: string;
}

/** The keys a block answers to, for `aria-keyshortcuts`. */
function shortcutsOf(movable: boolean, resizable: boolean): string | undefined {
  const keys = [
    movable ? 'Alt+ArrowLeft Alt+ArrowRight' : '',
    resizable ? 'Shift+ArrowLeft Shift+ArrowRight Shift+Alt+ArrowLeft Shift+Alt+ArrowRight' : '',
  ];
  return keys.filter(Boolean).join(' ') || undefined;
}

function Handle({ side, onPointerDown, testId }: { side: 'l' | 'r'; onPointerDown: (event: React.PointerEvent<HTMLElement>) => void; testId: string }) {
  return <Box component="span" aria-hidden sx={handleSx(side)} data-testid={testId} onPointerDown={onPointerDown} />;
}

interface BlockProps {
  row: DayRulerRow;
  block: DayRulerBlock;
  /** Where it is drawn: its own hours, or where a drag has it now. */
  span: Span;
  /** The hours it is drawn at (its own, or a drag's). */
  at: { start: RulerHour; end: RulerHour };
  text: string;
  ctx: RowContext;
  testId: string;
}

/**
 * The block's break, where it falls inside the block as drawn: it moves with a
 * dragged block (same offset from its start) and is cut to the block's ends.
 */
function breakShare(block: DayRulerBlock, start: RulerHour, end: RulerHour): Span | null {
  const span = block.breakSpan;
  const length = end - start;
  if (!span || !(length > 0)) return null;
  const shift = Math.abs(length - (block.end - block.start)) < 1e-6 ? start - block.start : 0;
  const a = Math.max(start, span.start + shift);
  const b = Math.min(end, span.end + shift);
  if (!(b > a)) return null;
  return { at: ((a - start) / length) * 100, share: ((b - a) / length) * 100 };
}

/** The block's break as a hatched band, when it falls inside the block as drawn. */
function BreakBand({ block, at, testId }: { block: DayRulerBlock; at: BlockProps['at']; testId: string }): React.JSX.Element | null {
  const gap = breakShare(block, at.start, at.end);
  if (!gap) return null;
  return <Box component="span" aria-hidden sx={breakSx(gap)} data-dr-break="" data-testid={testId} />;
}

function RulerBlock({ row, block, span, at, text, ctx, testId }: BlockProps): React.JSX.Element {
  const { can, dragApi, scale } = ctx;
  const movable = can.move && Boolean(block.movable);
  const resizable = can.resize && Boolean(block.resizable);
  const ref = useRef<HTMLButtonElement | null>(null);
  // Short by pixels; where nothing can be measured, by the prototype's 30% rule.
  const fits = useTextFits(ref, text, (block.end - block.start) / (scale.to - scale.from) >= M.narrowShare);
  const press = (mode: 'move' | 'start' | 'end') => (event: React.PointerEvent<HTMLElement>) =>
    dragApi.startBlock(event, row.id, block, mode);
  return (
    <Box
      component="button"
      type="button"
      sx={blockSx(block.tone, span, { selected: Boolean(block.selected), movable })}
      title={block.title ?? block.label}
      aria-keyshortcuts={shortcutsOf(movable, resizable)}
      aria-current={block.selected ? 'true' : undefined}
      ref={ref}
      data-narrow={fits ? undefined : ''}
      data-tone={block.tone}
      data-testid={testId}
      onPointerDown={movable ? press('move') : undefined}
      onClick={() => {
        if (!dragApi.takeClick()) ctx.onBlockClick?.(block.id);
      }}
      onKeyDown={(event: React.KeyboardEvent) => ctx.onBlockKey(event, block)}
    >
      <BreakBand block={block} at={at} testId={`${ctx.testId}-break-${block.id}`} />
      {resizable ? <Handle side="l" onPointerDown={press('start')} testId={`${ctx.testId}-handle-l-${block.id}`} /> : null}
      <span data-dr-text="full" title={text}>
        {text}
      </span>
      <span data-dr-text="short" title={text}>
        {block.shortLabel ?? text}
      </span>
      {resizable ? <Handle side="r" onPointerDown={press('end')} testId={`${ctx.testId}-handle-r-${block.id}`} /> : null}
    </Box>
  );
}

/** A row's blocks, each where a drag has it now (with its live hours) or where it is. */
function Blocks({ row, ctx }: { row: DayRulerRow; ctx: RowContext }): React.JSX.Element {
  const mine = ctx.drag && ctx.drag.rowId === row.id ? ctx.drag : null;
  return (
    <>
      {row.blocks.map((block) => {
        const live = mine?.blockId === block.id ? mine : null;
        const start = live ? live.start : block.start;
        const end = live ? live.end : block.end;
        return (
          <RulerBlock
            key={block.id}
            row={row}
            block={block}
            span={spanOf(start, end, ctx.scale)}
            at={{ start, end }}
            text={live?.moved ? formatRange(start, end) : block.label}
            ctx={ctx}
            testId={`${ctx.testId}-block-${block.id}`}
          />
        );
      })}
      {mine && mine.mode === 'create' ? <CreatePreview row={row} drag={mine} ctx={ctx} /> : null}
    </>
  );
}

/** The block a create drag is drawing, with its live hours. */
function CreatePreview({ row, drag, ctx }: { row: DayRulerRow; drag: RulerDrag; ctx: RowContext }): React.JSX.Element {
  const range = formatRange(drag.start, drag.end);
  return (
    <RulerBlock
      row={row}
      block={{ id: '\u0000new', start: drag.start, end: drag.end, label: range, tone: 'plan' }}
      span={spanOf(drag.start, Math.max(drag.end, drag.start + ctx.scale.snap), ctx.scale)}
      at={{ start: drag.start, end: drag.end }}
      text={range}
      ctx={ctx}
      testId={`${ctx.testId}-preview`}
    />
  );
}

/** The real shift under the blocks, and its label at its start. */
function Actual({ row, ctx }: { row: DayRulerRow; ctx: RowContext }): React.JSX.Element | null {
  const { actual } = row;
  if (!actual) return null;
  return (
    <>
      <Box sx={actualSx(spanOf(actual.start, actual.end, ctx.scale))} data-testid={`${ctx.testId}-actual-${row.id}`} />
      {row.actualLabel ? (
        <Box component="span" sx={actualLabelSx(percentOf(actual.start, ctx.scale.from, ctx.scale.to))}>
          {row.actualLabel}
        </Box>
      ) : null}
    </>
  );
}

/** A row's track: the actual bar, its blocks (or the one being dragged, live) and the now line. */
function Track({ row, ctx }: { row: DayRulerRow; ctx: RowContext }): React.JSX.Element {
  const { scale, now, can, dragApi } = ctx;
  const showNow = now !== undefined && now >= scale.from && now <= scale.to;
  return (
    <Box
      sx={trackSx({ hours: scale.to - scale.from, tickHours: scale.tickHours, interactive: can.create })}
      data-dr-track=""
      data-testid={`${ctx.testId}-track-${row.id}`}
      role={can.create ? 'group' : undefined}
      tabIndex={can.create ? 0 : undefined}
      aria-label={can.create ? ctx.createLabel(row.label) : undefined}
      onPointerDown={can.create ? (event: React.PointerEvent<HTMLElement>) => dragApi.startCreate(event, row.id) : undefined}
      onKeyDown={(event: React.KeyboardEvent) => {
        if (!can.create || event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        ctx.onKeyCreate(row);
      }}
    >
      <Actual row={row} ctx={ctx} />
      <Blocks row={row} ctx={ctx} />
      {showNow ? <Box sx={nowSx(percentOf(now, scale.from, scale.to))} data-testid={`${ctx.testId}-now`} /> : null}
    </Box>
  );
}

/** One person: name, meta and chips · the track · the row's actions. */
export function RulerRow({ row, ctx }: { row: DayRulerRow; ctx: RowContext }): React.JSX.Element {
  return (
    <Box sx={rowSx} data-testid={`${ctx.testId}-row-${row.id}`} role="listitem">
      <ScheduleNameCell row={row} sx={whoSx} sizes={{ name: M.name, meta: M.meta, chipsTop: 0.75 }} />
      <Track row={row} ctx={ctx} />
      <Box sx={actionsSx}>{row.actions}</Box>
    </Box>
  );
}

/** "Na escala, por hora": a count per hour above the axis. */
export function Coverage(props: { coverage: readonly number[]; label?: string; scale: RulerScale; testId: string }): React.JSX.Element {
  const { coverage, label, scale, testId } = props;
  const hours = scale.to - scale.from;
  return (
    <Box sx={lineSx} data-testid={`${testId}-coverage`}>
      <Box component="span" sx={coverageLabelSx}>
        {label}
      </Box>
      <Box sx={coverageSx(hours)}>
        {Array.from({ length: hours }, (_, index) => {
          const count = coverage[index] ?? 0;
          return (
            <Box key={index} component="span" sx={coverageCellSx(count)} title={`${formatHour(scale.from + index)} · ${count}`}>
              {count > 0 ? count : ''}
            </Box>
          );
        })}
      </Box>
      <span />
    </Box>
  );
}

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

function FooterCells({ cells, hours, from }: { cells: readonly DayRulerFooterCell[]; hours: number; from: RulerHour }): React.JSX.Element {
  return (
    <Box sx={coverageSx(hours)}>
      {Array.from({ length: hours }, (_, index) => {
        const cell = cells[index] ?? { text: '' };
        return (
          <Box
            key={index}
            component="span"
            sx={footerCellSx(Boolean(cell.marked))}
            title={cell.title ?? `${formatHour(from + index)} · ${cell.text}`}
            data-marked={cell.marked ? '' : undefined}
          >
            {cell.text}
          </Box>
        );
      })}
    </Box>
  );
}

function FooterFigures({ row, hours, from }: { row: DayRulerFooterRow; hours: number; from: RulerHour }): React.JSX.Element {
  if (row.trend) {
    return (
      <Box component="svg" viewBox="0 0 100 40" preserveAspectRatio="none" sx={trendSx} role="img" aria-label={row.label}>
        <polyline fill="none" stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke" points={trendPoints(row.trend, hours)} />
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
  return <FooterCells cells={row.cells ?? []} hours={hours} from={from} />;
}

/** A group's lines under its rows (FUT-3882): counts per hour, a trend, or a sentence, on the tracks' columns. */
export function GroupFooter(props: { rows: readonly DayRulerFooterRow[]; scale: RulerScale; testId: string }): React.JSX.Element {
  const { rows, scale, testId } = props;
  const hours = scale.to - scale.from;
  return (
    <>
      {rows.map((row) => (
        <Box key={row.id} sx={lineSx} data-testid={`${testId}-footer-${row.id}`}>
          <Box component="span" sx={coverageLabelSx}>
            {row.label}
          </Box>
          <FooterFigures row={row} hours={hours} from={scale.from} />
          <span />
        </Box>
      ))}
    </>
  );
}

/** The hour labels under the coverage row. */
export function Axis({ scale, testId }: { scale: RulerScale; testId: string }): React.JSX.Element {
  return (
    <Box sx={lineSx} data-testid={`${testId}-axis`} aria-hidden>
      <span />
      <Box sx={axisSx}>
        {ticksOf(scale.from, scale.to, scale.tickHours).map((h) => (
          <span key={h} style={{ left: `${percentOf(h, scale.from, scale.to)}%` }}>
            {formatHour(h)}
          </span>
        ))}
      </Box>
      <span />
    </Box>
  );
}
