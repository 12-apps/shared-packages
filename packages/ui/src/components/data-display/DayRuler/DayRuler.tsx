'use client';

import Box from '@mui/material/Box/index.js';
import type React from 'react';

import { EN_US_UI_LABELS } from '../../../en-US.labels';
import { resolveLabels } from '../../../utils/resolve-labels';
import { SR_ONLY_SX } from '../ScheduleGrid/ScheduleGrid.styles';
import { useAnnouncer } from '../ScheduleGrid/useAnnouncer';
import { handleBlockKey, keyCreateSpan, type RulerAbilities, type RulerScale } from './DayRuler.keyboard';
import { DAY_RULER_METRICS as M } from './DayRuler.metrics';
import { Axis, Coverage, RulerRow, type RowContext } from './DayRuler.parts';
import { groupTitleSx, rootSx, rowSx, skeletonNameSx, skeletonTrackSx } from './DayRuler.styles';
import type { DayRulerProps, DayRulerRow } from './DayRuler.types';
import { useRulerDrag } from './useRulerDrag';

/** The rows, grouped under a heading each time `row.group` changes. */
function grouped(rows: readonly DayRulerRow[]): { title?: string; rows: DayRulerRow[] }[] {
  const out: { title?: string; rows: DayRulerRow[] }[] = [];
  for (const row of rows) {
    const last = out[out.length - 1];
    if (last && last.title === row.group) last.rows.push(row);
    else out.push({ title: row.group, rows: [row] });
  }
  return out;
}

function scaleOf(props: DayRulerProps): RulerScale {
  return {
    from: props.from ?? 6,
    to: props.to ?? 26,
    snap: (props.snapMinutes ?? 15) / 60,
    createHours: props.createHours ?? 4,
    tickHours: props.tickHours ?? 4,
  };
}

function abilitiesOf(props: DayRulerProps): RulerAbilities {
  const open = !props.readOnly && !props.loading;
  return { create: open && Boolean(props.onCreate), move: open && Boolean(props.onMove), resize: open && Boolean(props.onResize) };
}

/** The groups and their rows — or the skeleton, the host's error, or the host's empty state. */
function RulerBody({ props, ctx }: { props: DayRulerProps; ctx: RowContext }): React.JSX.Element {
  if (props.error) return <>{props.error}</>;
  if (props.loading) {
    return (
      <>
        {Array.from({ length: M.skeletonRows }, (_, index) => (
          <Box key={index} sx={rowSx} aria-hidden data-testid={`${ctx.testId}-loading`}>
            <Box sx={skeletonNameSx} />
            <Box sx={skeletonTrackSx} />
          </Box>
        ))}
      </>
    );
  }
  if (props.rows.length === 0) return <>{props.empty ?? null}</>;
  return (
    <>
      {grouped(props.rows).map((group, index) => (
        <Box key={`${index}-${group.title ?? ''}`} role="list" aria-label={group.title}>
          {group.title ? (
            <Box component="p" sx={groupTitleSx} aria-hidden>
              {group.title}
            </Box>
          ) : null}
          {group.rows.map((row) => (
            <RulerRow key={row.id} row={row} ctx={ctx} />
          ))}
        </Box>
      ))}
    </>
  );
}

/**
 * One day as an hour ruler per row — who is on the escala when, and who is
 * really on shift (FUT-3825). Drag on an empty stretch to create (a click
 * alone is `createHours`), drag a block to move it, drag its ends to change
 * them; every hour snaps to `snapMinutes`. On a narrow ruler (a phone) each row
 * stacks and the blocks are tap-only: touch scrolls and never drags.
 *
 * The ruler reports gestures; hours, limits and refusals are the host's.
 */
export function DayRuler(props: DayRulerProps): React.JSX.Element {
  const { now, onCreate, onMove, onResize } = props;
  const testId = props.dataTestId ?? 'day-ruler';
  const labels = resolveLabels(EN_US_UI_LABELS.dayRuler, props.labels);
  const scale = scaleOf(props);
  const can = abilitiesOf(props);
  const dragApi = useRulerDrag(scale, { onCreate, onMove, onResize });
  const { text: announcement, say } = useAnnouncer();

  const ctx: RowContext = {
    scale,
    now,
    can,
    drag: dragApi.drag,
    dragApi,
    onBlockClick: props.onBlockClick,
    onKeyCreate: (row) => {
      const [start, end] = keyCreateSpan(scale, now, props.createStart?.(row.id));
      onCreate?.(row.id, start, end);
    },
    onBlockKey: (event, block) => handleBlockKey(event, block, { scale, can, onMove, onResize, labels, say }),
    createLabel: labels.createTrack,
    testId,
  };

  return (
    <Box
      sx={rootSx}
      data-testid={testId}
      role="region"
      aria-label={props['aria-label']}
      aria-busy={props.loading || undefined}
      aria-description={props.loading ? labels.loading : undefined}
    >
      {props.coverage && props.coverage.length > 0 ? (
        <Coverage coverage={props.coverage} label={props.coverageLabel} scale={scale} testId={testId} />
      ) : null}
      <Axis scale={scale} testId={testId} />
      <RulerBody props={props} ctx={ctx} />
      <Box sx={SR_ONLY_SX} aria-live="polite" role="status" data-testid={`${testId}-live`}>
        {announcement}
      </Box>
    </Box>
  );
}
