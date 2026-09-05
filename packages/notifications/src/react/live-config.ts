/**
 * The host's half of live activities: where they come from, and what they say.
 *
 * Both are the host's because neither can be this package's. It has no idea
 * what is happening — only the application does — and it has no words, for the
 * same reason `NotificationMessages` is required rather than defaulted: a
 * package that ships one product's sentences ships them to every other product
 * too, and the adopter reached by saying nothing is the one who never notices.
 */
import type { ReactNode } from 'react';

import type { LiveActivity } from '../live';

/**
 * Where the surface gets the activities that are live RIGHT NOW.
 *
 * A HOOK rather than a fetcher, and rather than a factory-time `subscribe`,
 * because the answer almost always lives in React context: the tenant, the
 * session, the host's query client. `NotificationsSignalHook` exists for
 * exactly this reason one seam over, and a host in that shape had no way to
 * pass anything at all.
 *
 * `active` is whether the surface currently needs the answer. It is a HINT
 * about need, never about correctness: a host that ignores it and always
 * answers is behaving correctly and merely paying for it.
 *
 * What it is NOT is the only thing standing between a shut panel and a query.
 * The panel is fetched lazily and renders nothing until somebody first opens
 * the bell, and the drawer unmounts its content on close — so a host that
 * simply reads `active` and ignores it still issues nothing while the panel is
 * away. `active` is `false` for the frames of the closing transition, which is
 * where it earns its keep: a query told to stand down there does not fire one
 * last time on the way out.
 *
 * Return whatever is live, newest activity first or in whatever order the host
 * means; the surface renders them in the order given. An empty array is the
 * normal answer and renders nothing — no heading, no empty state, no gap.
 */
export type LiveActivitiesHook = (options: {
  active: boolean;
}) => readonly LiveActivity[];

/** The three sentences the live section says. */
export interface LiveActivityMessages {
  /** The heading over the pinned entries, e.g. "Em andamento". */
  sectionTitle: string;
  /** The link's accessible name, e.g. `(title) => `Abrir ${title}``. */
  openActivity: (title: string) => string;
  /**
   * The "last moved" line, given an already-relative time.
   *
   * Takes the phrase rather than the instant so the relative wording stays in
   * ONE place — `relativeTime` and the inbox rows' `há 5 min` — and a host
   * cannot end up with two vocabularies for the same duration in one panel.
   */
  updated: (relative: string) => string;
}

/** Live activities, as a host turns them on. */
export interface LiveActivitiesConfig {
  useActivities: LiveActivitiesHook;
  messages: LiveActivityMessages;
  /**
   * The mark on the left of a card — the fastest read, before any words.
   *
   * A node rather than a field on {@link LiveActivity} so the contract stays
   * framework-free: the root entry is shared with the server half, and a
   * `ReactNode` in it would put React on that import path for a backend that
   * only ever writes rows. The host switches on `kind`, which is what `kind` is
   * for. No renderer, no mark, and the card is text — never a placeholder box.
   *
   * **Return something PRESENTATIONAL.** The mark is drawn inside the card's
   * own `<button>` and inside an `aria-hidden` wrapper, so a focusable node
   * here is a button inside a button — invalid HTML, and the exact defect the
   * card's structure exists to prevent — as well as a control hidden from the
   * accessibility tree. An icon or an `<svg>`; not a control.
   */
  renderIcon?: (activity: LiveActivity) => ReactNode;
}
