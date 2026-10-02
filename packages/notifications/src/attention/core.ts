/**
 * The attention queue — framework-free (`@12-apps/notifications/attention`).
 *
 * An inbox notification is an EVENT that happened; a live activity is STATE a
 * reader follows. Attention is a third thing: something waiting on the person
 * looking at the screen, with a clock on it — a plate under the lamp, a call
 * nobody answered, a courier at the door. It is not read and not dismissed;
 * it leaves when the work is done, and until then it grows more urgent.
 *
 * This module decides ONE thing: given everything waiting, which item does the
 * reader do next, and how loudly does it ask. The host declares the KINDS (what
 * a clock is measured against, which category a kind belongs to, who may see
 * it, the conditions under which it is urgent) in one wiring file; the package
 * owns the ordering and the vocabulary of urgency, so every adopter's button
 * agrees on what "late" means.
 *
 * ## The order, and why severity comes first
 *
 * 1. **Severity** — `spent` before `late` before `calm`. A plate that has
 *    waited twice its budget outranks any fresh call, whatever its category.
 * 2. **Category** — the wiring's `categories`, in the order written there.
 * 3. **Kind** — the order the kinds are listed in, inside that category.
 * 4. **Wait** — the longest wait first.
 * 5. **Id** — so two equal entries never swap places between renders.
 */

/** How loudly an item asks: inside its budget, past it, or past twice it. */
export type AttentionSeverity = 'calm' | 'late' | 'spent';

/** The severities, most urgent first. */
export const ATTENTION_SEVERITIES: readonly AttentionSeverity[] = ['spent', 'late', 'calm'];

const SEVERITY_WEIGHT: Readonly<Record<AttentionSeverity, number>> = {
  spent: 2,
  late: 1,
  calm: 0,
};

/** Is `a` more urgent than `b`? */
export function isMoreSevere(a: AttentionSeverity, b: AttentionSeverity): boolean {
  return SEVERITY_WEIGHT[a] > SEVERITY_WEIGHT[b];
}

/** The most severe of a list, or `null` for an empty one. */
export function worstSeverity(list: readonly AttentionSeverity[]): AttentionSeverity | null {
  let worst: AttentionSeverity | null = null;
  for (const severity of list) {
    if (worst === null || isMoreSevere(severity, worst)) worst = severity;
  }
  return worst;
}

/** One thing waiting. `since` is when its clock started, in epoch ms. */
export interface AttentionItem {
  readonly id: string;
  readonly kind: string;
  readonly since: number;
}

/** What a kind's `severity` rule is handed. */
export interface AttentionClock<I extends AttentionItem = AttentionItem> {
  readonly item: I;
  readonly waitedMs: number;
  /** Time waited as a share of the budget: 1 = the budget spent. */
  readonly lap: number;
}

/** One kind of thing that can wait on somebody, as the host's wiring declares it. */
export interface AttentionKind<I extends AttentionItem = AttentionItem> {
  /** Unique across the wiring; an item's `kind` names it. */
  readonly id: string;
  /** One of the wiring's `categories`. */
  readonly category: string;
  /** The budget x a lap is counted in, in ms — fixed, or per item. */
  readonly budgetMs: number | ((item: I) => number);
  /**
   * The CONDITIONS under which this kind is urgent. Omitted, the default ladder:
   * calm under one lap, late from one, spent from two. A kind that is urgent
   * from the moment it opens returns `late` here whatever the clock says.
   */
  readonly severity?: (clock: AttentionClock<I>) => AttentionSeverity;
  /** Who may see it: any of these. Omitted, everyone the host shows the button to. */
  readonly permission?: string | readonly string[];
  /**
   * The kind's place inside its category; kinds sharing a rank are one tier,
   * ordered by wait (a call and a bill, say). Omitted, the order they are
   * listed in.
   */
  readonly rank?: number;
}

/** The host's wiring: the category order, and every kind. */
export interface AttentionWiring {
  /** Most important first — the tie-break between equally severe items. */
  readonly categories: readonly string[];
  readonly kinds: readonly AttentionKind[];
}

/** A wiring checked once, with its lookups built. */
export interface AttentionRegistry {
  readonly categories: readonly string[];
  readonly kinds: readonly AttentionKind[];
  kind(id: string): AttentionKind | undefined;
}

/** Thrown at wiring time, so a broken declaration never reaches a screen. */
export class AttentionWiringError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttentionWiringError';
  }
}

/**
 * Declare one kind with its own item type. The registry holds kinds of every
 * item type side by side; this is the one place that widening happens, so a
 * kind's own rules are still checked against the item it was written for.
 */
export function attentionKind<I extends AttentionItem>(kind: AttentionKind<I>): AttentionKind {
  return kind as unknown as AttentionKind;
}

/** Check a wiring and build its lookups. Throws `AttentionWiringError`. */
export function defineAttention(wiring: AttentionWiring): AttentionRegistry {
  const categories = new Set(wiring.categories);
  if (categories.size !== wiring.categories.length) {
    throw new AttentionWiringError('A category is listed twice.');
  }
  const byId = new Map<string, AttentionKind>();
  for (const kind of wiring.kinds) {
    if (byId.has(kind.id)) throw new AttentionWiringError(`Kind "${kind.id}" is declared twice.`);
    if (!categories.has(kind.category)) {
      throw new AttentionWiringError(
        `Kind "${kind.id}" names category "${kind.category}", which is not listed.`,
      );
    }
    if (typeof kind.budgetMs === 'number' && !(kind.budgetMs > 0)) {
      throw new AttentionWiringError(`Kind "${kind.id}" needs a budget above zero.`);
    }
    byId.set(kind.id, kind);
  }
  return {
    categories: wiring.categories,
    kinds: wiring.kinds,
    kind: (id) => byId.get(id),
  };
}

/** The default ladder: calm under one lap, late from one, spent from two. */
export function severityOfLap(lap: number): AttentionSeverity {
  if (lap >= 2) return 'spent';
  if (lap >= 1) return 'late';
  return 'calm';
}

/** One item, placed: its kind, its clock and how loudly it asks. */
export interface AttentionEntry<I extends AttentionItem = AttentionItem> {
  readonly item: I;
  readonly kind: AttentionKind;
  readonly severity: AttentionSeverity;
  readonly waitedMs: number;
  readonly lap: number;
  /** How far round the ring is drawn, 0..1: the first lap while calm, the second while late, full when spent. */
  readonly progress: number;
}

/** The queue, read once for one moment. */
export interface AttentionReading<I extends AttentionItem = AttentionItem> {
  /** Everything visible, most urgent first. */
  readonly entries: readonly AttentionEntry<I>[];
  /** What to do next — the button's subject. */
  readonly head: AttentionEntry<I> | null;
  /** Everything after the head. */
  readonly others: readonly AttentionEntry<I>[];
  /** The most severe of `others` — the colour of the "+N". */
  readonly othersSeverity: AttentionSeverity | null;
}

export interface ReadAttentionOptions {
  readonly now: number;
  /** Does the reader hold this permission? Omitted, every permission is held. */
  readonly can?: (permission: string) => boolean;
}

function visible(kind: AttentionKind, can: ((permission: string) => boolean) | undefined): boolean {
  if (kind.permission === undefined || can === undefined) return true;
  const any = typeof kind.permission === 'string' ? [kind.permission] : kind.permission;
  return any.some((permission) => can(permission));
}

function place(item: AttentionItem, kind: AttentionKind, now: number): AttentionEntry {
  const budget = typeof kind.budgetMs === 'number' ? kind.budgetMs : kind.budgetMs(item);
  const waitedMs = Number.isFinite(item.since) ? Math.max(0, now - item.since) : 0;
  const lap = budget > 0 ? waitedMs / budget : 0;
  const severity = kind.severity ? kind.severity({ item, waitedMs, lap }) : severityOfLap(lap);
  // A kind may be late before one lap (its own conditions): its ring then
  // still shows the first lap, so it never sits empty.
  const progress =
    severity === 'spent'
      ? 1
      : severity === 'late' && lap >= 1
        ? Math.min(1, lap - 1)
        : Math.min(1, Math.max(0, lap));
  return { item, kind, severity, waitedMs, lap, progress };
}

const byId = (a: AttentionEntry, b: AttentionEntry): number =>
  a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0;

/** The queue's order — see "The order, and why severity comes first" above. */
function byUrgency(
  categoryOrder: ReadonlyMap<string, number>,
  kindOrder: ReadonlyMap<string, number>,
): (a: AttentionEntry, b: AttentionEntry) => number {
  const rankOf = (order: ReadonlyMap<string, number>, key: string): number => order.get(key) ?? 0;
  return (a, b) =>
    SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity] ||
    rankOf(categoryOrder, a.kind.category) - rankOf(categoryOrder, b.kind.category) ||
    rankOf(kindOrder, a.kind.id) - rankOf(kindOrder, b.kind.id) ||
    b.waitedMs - a.waitedMs ||
    byId(a, b);
}

/**
 * Rank everything waiting. Items of an undeclared kind are dropped rather than
 * thrown on — a server one release ahead of the screen must not blank it.
 */
export function readAttention<I extends AttentionItem>(
  registry: AttentionRegistry,
  items: readonly I[],
  options: ReadAttentionOptions,
): AttentionReading<I> {
  const categoryOrder = new Map(registry.categories.map((category, index) => [category, index]));
  const kindOrder = new Map(registry.kinds.map((kind, index) => [kind.id, kind.rank ?? index]));
  const entries = items
    .flatMap((item) => {
      const kind = registry.kind(item.kind);
      return kind !== undefined && visible(kind, options.can) ? [place(item, kind, options.now)] : [];
    })
    .sort(byUrgency(categoryOrder, kindOrder)) as AttentionEntry<I>[];
  const [head = null, ...others] = entries;
  return {
    entries,
    head,
    others,
    othersSeverity: worstSeverity(others.map((entry) => entry.severity)),
  };
}

/**
 * How hard the button asks for the eye: still while there is plenty of time,
 * a soft pulse from 40% of the budget, a full one from 70% and while late, and
 * something different again once spent.
 */
export type AttentionPulse = 'still' | 'soft' | 'strong' | 'spent';

export function pulseOf(entry: Pick<AttentionEntry, 'severity' | 'progress'>): AttentionPulse {
  if (entry.severity === 'spent') return 'spent';
  if (entry.severity === 'late') return 'strong';
  if (entry.progress >= 0.7) return 'strong';
  if (entry.progress >= 0.4) return 'soft';
  return 'still';
}

/** A channel's setting on one device: never, only for urgent items, or for everything. */
export type AttentionChannelLevel = 'off' | 'late' | 'all';

/** Does a channel set to `level` fire for an item at `severity`? */
export function channelWants(level: AttentionChannelLevel, severity: AttentionSeverity): boolean {
  if (level === 'all') return true;
  if (level === 'late') return severity !== 'calm';
  return false;
}

/** What the reader last saw: each id with the severity it had. */
export type AttentionSnapshot = ReadonlyMap<string, AttentionSeverity>;

export function snapshotOf(entries: readonly AttentionEntry[]): AttentionSnapshot {
  return new Map(entries.map((entry) => [entry.item.id, entry.severity]));
}

/**
 * The most severe CHANGE between two readings: an item that arrived, or one
 * that became more urgent. `null` when nothing new needs announcing — an item
 * that merely stayed, or calmed down, rings nothing.
 */
export function announcementBetween(
  before: AttentionSnapshot,
  entries: readonly AttentionEntry[],
): AttentionEntry | null {
  let loudest: AttentionEntry | null = null;
  for (const entry of entries) {
    const was = before.get(entry.item.id);
    const isNews = was === undefined || isMoreSevere(entry.severity, was);
    if (isNews && (loudest === null || isMoreSevere(entry.severity, loudest.severity))) loudest = entry;
  }
  return loudest;
}
