import type { SequenceItem, SequenceSummary } from './SequenceResolver.types';

/**
 * THE RUN, as pure data: what was answered or passed over, and what is ahead.
 *
 * The queue is the host's live data, not a snapshot. An answer can resolve
 * other entries with it (one limit saved for every sibling of a product), a
 * refetch can drop the entry just answered, and a realtime push can add one —
 * so the run is NOT an index into the queue. It keeps the visited steps in the
 * order they were visited, and the steps still ahead in the order the queue
 * gave them; `syncRun` reconciles the second list with each new queue.
 */

/** How a visited step was left. */
export type Visit<I extends SequenceItem, R> =
  | { item: I; outcome: 'resolved'; result: R }
  | { item: I; outcome: 'skipped' };

export interface RunState<I extends SequenceItem, R> {
  /** Every step left behind, oldest first. Back pops the last one. */
  visits: Visit<I, R>[];
  /** The steps still ahead; the first is on screen. Empty means the end screen. */
  ahead: I[];
  /**
   * The step whose answer is being written, kept ahead even while the queue
   * lacks it (the host's refetch may drop it before the write returns).
   * Cleared when the run leaves it.
   */
  pinned?: string;
  /**
   * The steps Back returned to, kept ahead while the queue lacks them (the
   * host's inverse ran, its refetch has not put the entry back yet). A SET:
   * two Backs before one refetch hold both. A key leaves it when the queue
   * confirms the entry or the run leaves the step.
   */
  held: readonly string[];
}

function dedupe<I extends SequenceItem>(items: readonly I[], skip: ReadonlySet<string>): I[] {
  const seen = new Set(skip);
  const out: I[] = [];
  for (const item of items) {
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    out.push(item);
  }
  return out;
}

/** A fresh run over `queue` (a repeated key counts once). */
export function startRun<I extends SequenceItem, R>(queue: readonly I[]): RunState<I, R> {
  return { visits: [], ahead: dedupe(queue, new Set()), held: [] };
}

/**
 * The run against a new queue.
 *
 * - A step ahead that the queue no longer has is dropped — it was resolved
 *   elsewhere (siblings answered together, another device) — unless it is
 *   `pinned` or `held`.
 * - A held key the queue has again is released: the host confirmed it.
 * - A queue entry the run has not seen is appended, in queue order.
 * - The entries kept are refreshed from the queue (same key, newer data).
 * - Visited steps are history and never change.
 */
export function syncRun<I extends SequenceItem, R>(
  state: RunState<I, R>,
  queue: readonly I[],
): RunState<I, R> {
  const fresh = new Map(queue.map((item) => [item.key, item] as const));
  const kept = state.ahead.flatMap((item) => {
    const next = fresh.get(item.key);
    if (next) return [next];
    return item.key === state.pinned || state.held.includes(item.key) ? [item] : [];
  });
  const known = new Set([...state.visits.map((visit) => visit.item.key), ...kept.map((item) => item.key)]);
  const held = state.held.filter((key) => !fresh.has(key));
  return { ...state, ahead: [...kept, ...dedupe(queue, known)], held };
}

/** Keep `key` ahead whatever the queue says, until the run moves on (see {@link RunState.pinned}). */
export function pinRun<I extends SequenceItem, R>(state: RunState<I, R>, key: string): RunState<I, R> {
  return { ...state, pinned: key };
}

/** The step on screen, or `undefined` at the end. */
export function currentOf<I extends SequenceItem, R>(state: RunState<I, R>): I | undefined {
  return state.ahead[0];
}

/** The pins once the run leaves `key`: neither the write pin nor the held set keeps it. */
function leaving<I extends SequenceItem, R>(state: RunState<I, R>, key: string): Pick<RunState<I, R>, 'pinned' | 'held'> {
  return {
    pinned: state.pinned === key ? undefined : state.pinned,
    held: state.held.filter((held) => held !== key),
  };
}

/**
 * Answer `item` — the step that was on screen when the answer began (a pending
 * write keeps it there, see {@link RunState.pinned}). An item no longer ahead
 * was already answered (a double call): a no-op, as at the end.
 */
export function resolveRun<I extends SequenceItem, R>(
  state: RunState<I, R>,
  result: R,
  item: I | undefined = state.ahead[0],
): RunState<I, R> {
  if (!item || !state.ahead.some((entry) => entry.key === item.key)) return state;
  return {
    visits: [...state.visits, { item, outcome: 'resolved', result }],
    ahead: state.ahead.filter((entry) => entry.key !== item.key),
    ...leaving(state, item.key),
  };
}

/**
 * Pass over the step on screen. Given the `key` that was on screen when the
 * skip began, a step that has moved on since (a double call) is left alone. At
 * the end it is a no-op.
 */
export function skipRun<I extends SequenceItem, R>(state: RunState<I, R>, key?: string): RunState<I, R> {
  const [item, ...rest] = state.ahead;
  if (!item || (key !== undefined && item.key !== key)) return state;
  return { visits: [...state.visits, { item, outcome: 'skipped' }], ahead: rest, ...leaving(state, item.key) };
}

/** The step Back would return to, or `undefined` on the first one. */
export function previousOf<I extends SequenceItem, R>(state: RunState<I, R>): Visit<I, R> | undefined {
  return state.visits[state.visits.length - 1];
}

/**
 * Return to the previous step: it is on screen again, ahead of the rest, and
 * held until the queue confirms it. Given the `key` Back began from, a step
 * already returned to (a double call) is left alone.
 */
export function backRun<I extends SequenceItem, R>(state: RunState<I, R>, key?: string): RunState<I, R> {
  const last = previousOf(state);
  if (!last || (key !== undefined && last.item.key !== key)) return state;
  const ahead = state.ahead.filter((item) => item.key !== last.item.key);
  // The step being left keeps no write pin: `pinned` is for a write in flight
  // on the step ON SCREEN, and a failed one must not hold an entry the
  // host's refetch has since dropped (it was applied server-side).
  const leftKey = state.ahead[0]?.key;
  return {
    ...state,
    pinned: state.pinned === leftKey ? undefined : state.pinned,
    visits: state.visits.slice(0, -1),
    ahead: [last.item, ...ahead],
    held: [...state.held.filter((held) => held !== last.item.key), last.item.key],
  };
}

/** Where the run stands. */
export function summaryOf<I extends SequenceItem, R>(state: RunState<I, R>): SequenceSummary {
  const resolved = state.visits.filter((visit) => visit.outcome === 'resolved').length;
  return {
    resolved,
    skipped: state.visits.length - resolved,
    total: state.visits.length + state.ahead.length,
  };
}

/** 1-based position of the step on screen (`total + 1` never happens: at the end it is `total`). */
export function positionOf<I extends SequenceItem, R>(state: RunState<I, R>): number {
  return Math.min(state.visits.length + 1, state.visits.length + state.ahead.length);
}

/** How far along, 0..100. An empty run is complete. */
export function progressOf<I extends SequenceItem, R>(state: RunState<I, R>): number {
  const total = state.visits.length + state.ahead.length;
  return total === 0 ? 100 : Math.round((state.visits.length / total) * 100);
}
