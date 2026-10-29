'use client';

import Box from '@mui/material/Box/index.js';
import React, { useEffect, useRef } from 'react';

import { resolveLabels } from '../../../utils/resolve-labels';
import { EN_US_SCHEDULE_GRID_LABELS } from './ScheduleGrid.en-US';
import { focusables, handleGridKey } from './ScheduleGrid.keyboard';
import { GridBody, GridHeader, type CellAbilities } from './ScheduleGrid.parts';
import { frameSx, headerSx, rootSx, rowGridSx, scrollSx, SR_ONLY_SX } from './ScheduleGrid.styles';
import type { ScheduleGridProps } from './ScheduleGrid.types';
import { useAnnouncer } from './useAnnouncer';
import { useGridDrag } from './useGridDrag';
import { useScrollToDay } from './useScrollToDay';
import { useSidewaysScroll } from './useSidewaysScroll';

/**
 * After a keyboard move the host re-renders the block in its new cell (a new
 * element): focus follows it there. After a create on an empty day's "+" (Enter,
 * Space or a click) the "+" gives way to the host's new block: focus moves to
 * it, so the arrows go on from there — after a click without scrolling. A host
 * that refused keeps focus where it was; the next key or pointer press forgets
 * the wait.
 */
type FollowTarget = { kind: 'move'; id: string; day: number } | { kind: 'create'; row: string; day: number; pointer: boolean };

/** The empty day's "+" an event landed on, if any. */
function plusOf(target: EventTarget): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null;
  const plus = target.closest<HTMLElement>('button[data-sg-focus]');
  return plus && plus.dataset.sgBlock === undefined && plus.dataset.sgRow !== undefined ? plus : null;
}

function useFollowFocus(rootRef: React.RefObject<HTMLElement | null>) {
  const pending = useRef<FollowTarget | null>(null);
  useEffect(() => {
    const follow = pending.current;
    if (!follow || !rootRef.current) return;
    const block = focusables(rootRef.current).find((el) =>
      Number(el.dataset.sgDay) !== follow.day || el.dataset.sgBlock === undefined
        ? false
        : follow.kind === 'move'
          ? el.dataset.sgBlock === follow.id
          : el.dataset.sgRow === follow.row,
    );
    if (!block) return;
    // After a click the cell stays where the pointer left it: no scroll at all (FUT-3825 R1).
    block.focus(follow.kind === 'create' && follow.pointer ? { preventScroll: true } : undefined);
    pending.current = null;
  });
  return {
    follow: (id: string, day: number): void => {
      pending.current = { kind: 'move', id, day };
    },
    /** A key that presses an empty day's "+" (its click creates there). */
    followCreate: (event: React.KeyboardEvent): void => {
      const plus = plusOf(event.target);
      if ((event.key !== 'Enter' && event.key !== ' ') || !plus?.dataset.sgRow) return;
      pending.current = { kind: 'create', row: plus.dataset.sgRow, day: Number(plus.dataset.sgDay), pointer: false };
    },
    /** A pointer click on an empty day's "+" (a key's click, `detail` 0, is the key's). */
    followClickCreate: (event: React.MouseEvent): void => {
      const plus = plusOf(event.target);
      if (event.detail === 0 || !plus?.dataset.sgRow) return;
      pending.current = { kind: 'create', row: plus.dataset.sgRow, day: Number(plus.dataset.sgDay), pointer: true };
    },
    forget: (): void => {
      pending.current = null;
    },
  };
}

function abilitiesOf(props: ScheduleGridProps): CellAbilities {
  const open = !props.readOnly && !props.loading;
  return { create: open && Boolean(props.onCreate), copy: open && Boolean(props.onCopy), move: open && Boolean(props.onMove) };
}

/**
 * People (or resources) as rows, days as columns, and blocks with a start and
 * an end in the cells — the week grid of a staff schedule (FUT-3825).
 *
 * Click an empty cell to create on that day; drag across empty cells of a row
 * to create on each; drag a block's edge grip along its row to copy it; drag
 * its middle to move it to another day or row; click it to open it. Touch
 * scrolls and never drags. Every gesture has a keyboard twin.
 *
 * The grid reports gestures; the hours, limits and refusals are the host's.
 */
export function ScheduleGrid(props: ScheduleGridProps): React.JSX.Element {
  const { columns, groups, cell, onCreate, onCopy, onMove } = props;
  const testId = props.dataTestId ?? 'schedule-grid';
  const labels = resolveLabels(EN_US_SCHEDULE_GRID_LABELS, props.labels);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const { text: announcement, say } = useAnnouncer();
  const focus = useFollowFocus(rootRef);
  const dragApi = useGridDrag(rootRef, { cell, onCreate, onCopy, onMove });
  const can = abilitiesOf(props);
  const rows = groups.flatMap((group) => group.rows);
  const hasTotal = props.totalLabel !== undefined || rows.some((row) => row.total !== undefined);
  const rowSx = rowGridSx(columns.length, hasTotal);

  const headRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const sideways = useSidewaysScroll(headRef, bodyRef);
  useScrollToDay(headRef, bodyRef, props.scrollToDay, columns.length, sideways.follow);

  const onKeyDown = (event: React.KeyboardEvent): void => {
    sideways.release();
    focus.forget();
    if (!rootRef.current) return;
    if (can.create) focus.followCreate(event);
    handleGridKey(event, { root: rootRef.current, rows, columns, cell, can, onCopy, onMove, labels, say, follow: focus.follow });
  };

  return (
    <Box sx={rootSx} data-testid={testId}>
      <Box
        ref={rootRef}
        role="table"
        aria-label={props['aria-label']}
        aria-busy={props.loading || undefined}
        aria-description={props.loading ? labels.loading : undefined}
        sx={frameSx(columns.length, hasTotal)}
        onKeyDown={onKeyDown}
        onPointerDownCapture={focus.forget}
        onClickCapture={can.create ? focus.followClickCreate : undefined}
      >
        {/* The header row sits outside the sideways scroller, so it sticks to the page; it follows the days sideways. */}
        <Box ref={headRef} role="none" sx={headerSx(props.stickyTop ?? 0)} data-sg-head="" data-testid={`${testId}-head`} onWheel={sideways.forwardWheel}>
          <GridHeader columns={columns} totalLabel={hasTotal ? (props.totalLabel ?? '') : undefined} rowSx={rowSx} testId={testId} />
        </Box>
        <Box ref={bodyRef} role="none" sx={scrollSx} data-sg-scroll="" data-testid={`${testId}-scroll`} onScroll={sideways.follow}
          onFocus={sideways.bringOut}
          onPointerDownCapture={sideways.press}
        >
          <GridBody grid={props} rows={rows} rowSx={rowSx} hasTotal={hasTotal} can={can} dragApi={dragApi} labels={labels} testId={testId} />
        </Box>
      </Box>
      <Box sx={SR_ONLY_SX} aria-live="polite" role="status" data-testid={`${testId}-live`}>
        {announcement}
      </Box>
    </Box>
  );
}
