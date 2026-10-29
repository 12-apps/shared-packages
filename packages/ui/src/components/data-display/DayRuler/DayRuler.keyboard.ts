import type * as React from 'react';

import type { DayRulerLabels } from './DayRuler.labels';
import { DAY_RULER_METRICS as M } from './DayRuler.metrics';
import { clamp, formatRange, moved, resized, snapTo } from './day-ruler-model';
import type { DayRulerBlock, RulerHour } from './DayRuler.types';

/** The ruler's span and step, resolved once per render. */
export interface RulerScale {
  from: RulerHour;
  to: RulerHour;
  /** The snap, in hours (0.25 for 15 minutes). */
  snap: number;
  createHours: number;
  tickHours: number;
}

/** What the ruler lets a row do, resolved once per render. */
export interface RulerAbilities {
  create: boolean;
  move: boolean;
  resize: boolean;
}

/** Which gesture a modified arrow asks of a block, if the ruler allows it. */
type Gesture = 'move' | 'start' | 'end';

function gestureOf(event: React.KeyboardEvent, block: DayRulerBlock, can: RulerAbilities): Gesture | null {
  if (event.altKey && !event.shiftKey) return can.move && block.movable ? 'move' : null;
  if (!event.shiftKey) return null;
  if (!can.resize || !block.resizable) return null;
  return event.altKey ? 'start' : 'end';
}

/** The block's hours after one snap of `gesture` in `direction`. */
function stepped(block: DayRulerBlock, gesture: Gesture, direction: -1 | 1, scale: RulerScale): [RulerHour, RulerHour] {
  const step = direction * scale.snap;
  if (gesture === 'move') return moved(block.start, block.end, step, scale.from, scale.to);
  const edge = (gesture === 'start' ? block.start : block.end) + step;
  return resized(block.start, block.end, gesture, edge, M.minHours, scale.from, scale.to);
}

interface BlockKeyContext {
  scale: RulerScale;
  can: RulerAbilities;
  onMove?: (blockId: string, start: RulerHour, end: RulerHour) => void;
  onResize?: (blockId: string, start: RulerHour, end: RulerHour) => void;
  labels: DayRulerLabels;
  say: (text: string) => void;
}

/**
 * A focused block's keys (FUT-3825): Alt+←/→ moves it one snap, Shift+←/→
 * moves its end, Shift+Alt+←/→ its start. Each is read by the live region; one
 * that cannot go further, or that the block does not allow, is refused aloud
 * and changes nothing.
 */
/** Shift and/or Alt with ← or →, and no Ctrl or Meta: a key the ruler answers for a block. */
function isBlockKey(event: React.KeyboardEvent): boolean {
  const arrow = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
  return arrow && (event.altKey || event.shiftKey) && !event.ctrlKey && !event.metaKey;
}

export function handleBlockKey(event: React.KeyboardEvent, block: DayRulerBlock, ctx: BlockKeyContext): void {
  if (!isBlockKey(event)) return;
  // The key is the ruler's either way: Alt+← would otherwise be the browser's Back.
  event.preventDefault();
  const gesture = gestureOf(event, block, ctx.can);
  if (!gesture) {
    ctx.say(ctx.labels.notMovable);
    return;
  }
  const [start, end] = stepped(block, gesture, event.key === 'ArrowLeft' ? -1 : 1, ctx.scale);
  if (start === block.start && end === block.end) {
    ctx.say(ctx.labels.refused);
    return;
  }
  const range = formatRange(start, end);
  if (gesture === 'move') {
    ctx.onMove?.(block.id, start, end);
    ctx.say(ctx.labels.moved(block.label, range));
    return;
  }
  ctx.onResize?.(block.id, start, end);
  ctx.say(ctx.labels.resized(block.label, range));
}

/** Where Enter on a track creates: the host's `createStart`, else `now` snapped up, else `from` — kept on the ruler. */
export function keyCreateSpan(scale: RulerScale, now: RulerHour | undefined, hostStart: RulerHour | undefined): [RulerHour, RulerHour] {
  const onRuler = now !== undefined && now >= scale.from && now < scale.to;
  const fallback = onRuler ? Math.ceil(now / scale.snap) * scale.snap : scale.from;
  const start = clamp(snapTo(hostStart ?? fallback, scale.snap), scale.from, scale.to - M.minHours);
  return [start, Math.min(scale.to, start + scale.createHours)];
}
