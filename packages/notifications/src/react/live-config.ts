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

/**
 * What the section hands {@link LiveActivitiesConfig.renderCard} besides the
 * activity: the section's CLOCK, and the line it would have drawn from it.
 *
 * The clock is passed rather than read because the section owns the minute tick
 * (see `live-section.tsx`): a host body that called `Date.now()` itself would
 * freeze its "há 5 min" at the minute the card first rendered, which is the
 * defect `relative-time.ts` was changed to prevent.
 */
export interface LiveActivityRenderContext {
  /** The section's current minute, in epoch milliseconds. Moves once a minute. */
  now: number;
  /**
   * The default card's "last moved" line, already worded —
   * `messages.updated(relativeTime(activity.updatedAt, …, now))` — so a host
   * body can show it without a second vocabulary for the same duration.
   */
  updated: string;
}

/**
 * A host's own body for one live activity, or `null`/`undefined` for the
 * package's default card.
 *
 * Called during the section's render, once per activity per render (the minute
 * tick included), so keep it cheap and free of hooks — return an ELEMENT, and
 * put any hooks in the component it names.
 */
export type LiveActivityCardRenderer = (
  activity: LiveActivity,
  context: LiveActivityRenderContext,
) => ReactNode;

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
  /**
   * The host's own BODY for an activity whose shape the default card cannot
   * draw — a mesa counting plates per lane per round rather than lighting one
   * stop on one lane. Return `null` or `undefined` for any activity the default
   * card should draw; only those two fall back (`false` or `''` render as an
   * empty body).
   *
   * **The body is the host's; the SHELL stays the package's.** The section
   * keeps its clock (it arrives as `context.now`), and the node is drawn inside
   * the same card: the wash and border, the `live-activity-<id>` test id, the
   * stretched `<button>` named by `messages.openActivity(title)` when the
   * activity has a link and the host a router, the polite announcement of
   * `title` when it changes, and the seen record the bell reads.
   *
   * With a link, the node sits BESIDE the button rather than inside it, in an
   * `inert`, `aria-hidden` wrapper the button names as its description — so
   * its text is still read with the link, a click anywhere on it reaches the
   * card, and nothing in it can nest inside the button or take a tab stop.
   * That makes it PRESENTATIONAL for the same reason `renderIcon` is: a
   * control in it is unreachable. Without a link it renders as plain content.
   * `renderIcon` is not drawn for a host-rendered card — draw the mark in the
   * body.
   */
  renderCard?: LiveActivityCardRenderer;
}
