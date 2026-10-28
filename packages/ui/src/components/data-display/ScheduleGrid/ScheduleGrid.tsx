'use client';

import Box from '@mui/material/Box/index.js';
import React, { useEffect, useRef, useState } from 'react';

import { EN_US_UI_LABELS } from '../../../en-US.labels';
import { resolveLabels } from '../../../utils/resolve-labels';
import { focusables, handleGridKey } from './ScheduleGrid.keyboard';
import { GridBody, GridHeader, type CellAbilities } from './ScheduleGrid.parts';
import { frameSx, rootSx, rowGridSx, SR_ONLY_SX } from './ScheduleGrid.styles';
import type { ScheduleGridProps } from './ScheduleGrid.types';
import { useGridDrag } from './useGridDrag';

/** The live region's sentence; `seq` makes the same sentence twice read twice. */
interface Announcement {
  text: string;
  seq: number;
}

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
  const [announcement, setAnnouncement] = useState<Announcement>({ text: '', seq: 0 });
  const focus = useFollowFocus(rootRef);
  const dragApi = useGridDrag(rootRef, { cell, onCreate, onCopy, onMove });
  const can = abilitiesOf(props);
  const rows = groups.flatMap((group) => group.rows);
  const hasTotal = props.totalLabel !== undefined || rows.some((row) => row.total !== undefined);
  const rowSx = rowGridSx(columns.length, hasTotal);
  const say = (text: string): void => setAnnouncement((prev) => ({ text, seq: prev.seq + 1 }));

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
        sx={frameSx}
        onKeyDown={onKeyDown}
        onPointerDownCapture={focus.forget}
      >
        <GridHeader
          columns={columns}
          totalLabel={hasTotal ? (props.totalLabel ?? '') : undefined}
          rowSx={rowSx}
          stickyTop={props.stickyTop ?? 0}
          testId={testId}
        />
        <GridBody grid={props} rows={rows} rowSx={rowSx} hasTotal={hasTotal} can={can} dragApi={dragApi} labels={labels} testId={testId} />
      </Box>
      <Box sx={SR_ONLY_SX} aria-live="polite" role="status" data-testid={`${testId}-live`} key={announcement.seq}>
        {announcement.text}
      </Box>
    </Box>
  );
}
