/**
 * What the reader has already been shown, so the bell can say NEW rather than
 * merely PRESENT.
 *
 * A live activity is unlike an inbox row in the one way that matters here: it
 * stays on the panel for as long as the thing is happening, so its presence
 * cannot mean "you have not seen this". A pedido that has been `Preparo` for
 * ten minutes is still live and still worth counting, but nothing has happened
 * — and a badge that shouts for a subject the reader has already looked at is a
 * badge people stop reading.
 *
 * So presence and novelty are answered separately: the COUNT comes from how
 * many are live, and the TONE comes from this. The panel writes it — being on
 * screen is what seen means — and the bell reads it.
 *
 * ## Per subject, not one watermark
 *
 * A single "newest instant already seen" is smaller and was the first cut, and
 * it is wrong in a way that shows up in normal use: a pedido placed ten minutes
 * ago but only now reaching the client arrives with an `updatedAt` BEHIND the
 * watermark, and would be silently marked as already seen. The reader has never
 * laid eyes on it. Keyed by subject, an id that has not been recorded is new
 * whatever its clock says.
 *
 * Bounded by pruning rather than by expiry: every write keeps only the subjects
 * that are live at that moment, so the record can never outgrow the number of
 * things happening at once. A subject that finishes and later comes back is
 * news again, which is correct — it is a different occurrence.
 */
import type { LiveActivity } from '../live';

const STORAGE_KEY = '12a.notifications.live-seen';

/** id -> the `updatedAt` that was on screen. */
type SeenMap = Readonly<Record<string, string>>;

const EMPTY: SeenMap = {};

/** ms since epoch, or `null` for an absent or unparseable stamp. */
function instant(iso: string | undefined): number | null {
  if (iso === undefined) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Read/write through `try`, every time.
 *
 * `localStorage` is not merely absent in SSR and in a worker — the ACCESSOR
 * itself throws in a browser set to block site data. A notification bell that
 * cannot render because storage is blocked is a worse failure than one that
 * forgets what was seen, and forgetting degrades in the safe direction: towards
 * saying something is happening.
 */
function readStored(): SeenMap {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return EMPTY;
    // Anything can be in storage — another version of this package, or a person
    // with the devtools open. Keep only what has the shape this reads.
    const clean: Record<string, string> = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (typeof value === 'string') clean[id] = value;
    }
    return clean;
  } catch {
    return EMPTY;
  }
}

function writeStored(value: SeenMap): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Blocked or full. The badge stays new a while longer; nothing else breaks.
  }
}

export interface LiveSeenStore {
  /** What has been shown, keyed by subject id. */
  read: () => SeenMap;
  /** Record that exactly these are on screen now, forgetting subjects that are not. */
  mark: (activities: readonly LiveActivity[]) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createLiveSeenStore(): LiveSeenStore {
  // Mirrored in memory as well as in storage: `useSyncExternalStore` compares
  // snapshots by IDENTITY and calls `read` on every render, so parsing storage
  // there would hand it a fresh object each time and re-render for ever.
  let current = readStored();
  const listeners = new Set<() => void>();

  return {
    read: () => current,
    mark: (activities) => {
      const next: Record<string, string> = {};
      for (const activity of activities) next[activity.id] = activity.updatedAt;
      // Identity is the snapshot, so an unchanged map must not become a new
      // object — see `read` above.
      const ids = Object.keys(next);
      const same =
        ids.length === Object.keys(current).length &&
        ids.every((id) => current[id] === next[id]);
      if (same) return;
      current = next;
      writeStored(next);
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * Whether any of these has moved, or arrived, since the reader last looked.
 *
 * An id with nothing recorded is new — that is the case the per-subject record
 * exists for. An unparseable stamp is treated as new too: the alternative is
 * silently never alerting for a host whose clock format this does not read.
 */
export function hasUnseenActivity(
  activities: readonly LiveActivity[],
  seen: SeenMap,
): boolean {
  return activities.some((activity) => {
    const shown = instant(seen[activity.id]);
    if (shown === null) return true;
    const now = instant(activity.updatedAt);
    return now === null || now > shown;
  });
}
