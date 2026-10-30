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
  | {
      item: I;
      outcome: 'resolved';
      result: R;
      alsoResolved?: number;
      /** The step said `canGoBack: false` when it was answered: the answer has no inverse, so Back stops here. */
      final?: true;
    }
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

/**
 * A fresh run over `queue` (a repeated key counts once). With `initialKey` the
 * run opens at that entry; the entries before it follow it, in queue order —
 * nothing is passed over (a click on one problem's block opens the run there).
 */
export function startRun<I extends SequenceItem, R>(queue: readonly I[], initialKey?: string): RunState<I, R> {
  const ahead = dedupe(queue, new Set());
  const at = initialKey === undefined ? -1 : ahead.findIndex((item) => item.key === initialKey);
  const first = ahead[at];
  if (at <= 0 || !first) return { visits: [], ahead, held: [] };
  return { visits: [], ahead: [first, ...ahead.slice(0, at), ...ahead.slice(at + 1)], held: [] };
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
  alsoResolved = 0,
  final = false,
): RunState<I, R> {
  if (!item || !state.ahead.some((entry) => entry.key === item.key)) return state;
  const visit: Visit<I, R> = { item, outcome: 'resolved', result };
  if (alsoResolved > 0) visit.alsoResolved = alsoResolved;
  if (final) visit.final = true;
  return {
    visits: [...state.visits, visit],
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

/** True when Back may return from the step on screen: a previous step exists and its answer has an inverse. */
export function canReturn<I extends SequenceItem, R>(state: RunState<I, R>): boolean {
  const last = previousOf(state);
  return last !== undefined && !(last.outcome === 'resolved' && last.final);
}

/**
 * The step a jump to `keys` (one category of the overview) lands on: the
 * first of them still AHEAD, in run order; else the first one passed over
 * (skipped, or left by an earlier jump). An answered key is never a target.
 */
export function jumpTargetOf<I extends SequenceItem, R>(state: RunState<I, R>, keys: readonly string[]): string | undefined {
  const wanted = new Set(keys);
  const ahead = state.ahead.find((item) => wanted.has(item.key));
  if (ahead) return ahead.key;
  return state.visits.find((visit) => visit.outcome === 'skipped' && wanted.has(visit.item.key))?.item.key;
}

/**
 * Jump to `key` ("Ver todos" → a category's Resolver, or `api.jumpTo`).
 *
 * The step on screen is recorded as PASSED OVER — Back from the target returns
 * to it at once, with nothing to undo — and the target goes first; the rest
 * stays in run order. A target that was passed over before is taken back out
 * of the history. The step already on screen, an answered key or an unknown
 * one leaves the run as it is.
 */
export function jumpRun<I extends SequenceItem, R>(state: RunState<I, R>, key: string): RunState<I, R> {
  const [current] = state.ahead;
  if (current?.key === key) return state;
  const passed = state.visits.findIndex((visit) => visit.outcome === 'skipped' && visit.item.key === key);
  const target = state.ahead.find((item) => item.key === key) ?? state.visits[passed]?.item;
  if (!target) return state;
  const visits = passed >= 0 ? state.visits.filter((_, index) => index !== passed) : [...state.visits];
  const rest = state.ahead.filter((item) => item.key !== key && item.key !== current?.key);
  const pins = current ? leaving(state, current.key) : { pinned: state.pinned, held: state.held };
  return {
    visits: current ? [...visits, { item: current, outcome: 'skipped' }] : visits,
    ahead: [target, ...rest],
    ...pins,
  };
}

/** Where the run stands. */
export function summaryOf<I extends SequenceItem, R>(state: RunState<I, R>): SequenceSummary {
  const resolved = state.visits.filter((visit) => visit.outcome === 'resolved').length;
  const alsoResolved = state.visits.reduce(
    (sum, visit) => sum + (visit.outcome === 'resolved' ? Math.max(0, visit.alsoResolved ?? 0) : 0),
    0,
  );
  return {
    alsoResolved,
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
