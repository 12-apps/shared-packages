'use client';

import Box from '@mui/material/Box/index.js';
import React, { useEffect, useRef } from 'react';

import { EN_US_UI_LABELS } from '../../../en-US.labels';
import { resolveLabels } from '../../../utils/resolve-labels';
import { focusables, handleGridKey } from './ScheduleGrid.keyboard';
import { GridBody, GridHeader, type CellAbilities } from './ScheduleGrid.parts';
import { frameSx, headerSx, rootSx, rowGridSx, scrollSx, SR_ONLY_SX } from './ScheduleGrid.styles';
import type { ScheduleGridProps } from './ScheduleGrid.types';
import { useAnnouncer } from './useAnnouncer';
import { useGridDrag } from './useGridDrag';

/**
 * After a keyboard move the host re-renders the block in its new cell (a new
 * element): focus follows it there. A host that refused keeps it where it was;
 * the next key or pointer press forgets the wait.
 */
function useFollowFocus(rootRef: React.RefObject<HTMLElement | null>) {
  const pending = useRef<{ id: string; day: number } | null>(null);
  useEffect(() => {
    const follow = pending.current;
    if (!follow || !rootRef.current) return;
    const block = focusables(rootRef.current).find(
      (el) => el.dataset.sgBlock === follow.id && Number(el.dataset.sgDay) === follow.day,
    );
    if (!block) return;
    block.focus();
    pending.current = null;
  });
  return {
    follow: (id: string, day: number): void => {
      pending.current = { id, day };
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
  const labels = resolveLabels(EN_US_UI_LABELS.scheduleGrid, props.labels);
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
  // The header row and the days keep one sideways scroll, so each day's header stays over its column.
  // The scroll this sets echoes back as an event on the other side; that echo is skipped, so it
  // never fights a scroll still running (a trackpad's momentum).
  const echo = useRef<HTMLElement | null>(null);
  // While the days scroll, a cell the keyboard (or a script) focuses is brought out from under
  // the pinned names: the browser counts a cell under a sticky column as already in view.
  const clearTheNames = (event: React.FocusEvent<HTMLElement>): void => {
    const body = bodyRef.current;
    const target = event.target;
    if (!body || !(target instanceof HTMLElement) || target.closest('[role="rowheader"]')) return;
    const row = target.closest('[role="row"]');
    const names = row?.querySelector('[role="rowheader"]');
    if (!row || !names) return;
    const gap = Number.parseFloat(getComputedStyle(row).columnGap) || 0;
    const hidden = names.getBoundingClientRect().right + gap - target.getBoundingClientRect().left;
    if (hidden > 0) body.scrollLeft -= hidden;
  };
  const followSideways = (event: React.UIEvent<HTMLElement>): void => {
    const from = event.currentTarget;
    if (echo.current === from) {
      echo.current = null;
      return;
    }
    const other = from === bodyRef.current ? headRef.current : bodyRef.current;
    if (!other || other.scrollLeft === from.scrollLeft) return;
    echo.current = other;
    other.scrollLeft = from.scrollLeft;
  };

  const onKeyDown = (event: React.KeyboardEvent): void => {
    focus.forget();
    if (!rootRef.current) return;
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
      >
        {/* The header row sits outside the sideways scroller, so it sticks to the page; it follows the days sideways. */}
        <Box ref={headRef} role="none" sx={headerSx(props.stickyTop ?? 0)} data-sg-head="" data-testid={`${testId}-head`} onScroll={followSideways}>
          <GridHeader columns={columns} totalLabel={hasTotal ? (props.totalLabel ?? '') : undefined} rowSx={rowSx} testId={testId} />
        </Box>
        <Box ref={bodyRef} role="none" sx={scrollSx} data-sg-scroll="" data-testid={`${testId}-scroll`} onScroll={followSideways} onFocus={clearTheNames}>
          <GridBody grid={props} rows={rows} rowSx={rowSx} hasTotal={hasTotal} can={can} dragApi={dragApi} labels={labels} testId={testId} />
        </Box>
      </Box>
      <Box sx={SR_ONLY_SX} aria-live="polite" role="status" data-testid={`${testId}-live`}>
        {announcement}
      </Box>
    </Box>
  );
}
