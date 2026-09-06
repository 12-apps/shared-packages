/**
 * LIVE ACTIVITIES — the notification centre's second kind of entry.
 *
 * An inbox notification is an EVENT: it happened, it is stamped, it is read or
 * unread, and it is still there tomorrow saying the same thing. A live activity
 * is ONGOING STATE: it is pinned above the list, it has no read/unread, nobody
 * deletes it, it updates itself, and it is GONE the moment the thing it tracks
 * finishes.
 *
 * The distinction is not cosmetic. A row that says "your order is on its way",
 * read an hour later, is a claim about the past presented as news — and the
 * more reliable the inbox is, the more of those a person accumulates. Somewhere
 * in that list is the one question they actually have, which is *where is it
 * now*. A live activity answers that question and then removes itself, which is
 * the property no amount of better event copy can buy.
 *
 * ## This file is domain-free, and that is the whole design
 *
 * Nothing here knows what is being tracked. A host publishes activities through
 * `LiveActivitiesConfig.useActivities` (see `./react/live-config`) and this
 * package owns the contract, the placement, the rendering and the OS-level
 * collapse. The package that raises an alert has never been this package's
 * business — see the `generators` seam — and the thing an alert is ABOUT is not
 * either.
 *
 * ## The lane
 *
 * `steps` + `activeStepId` describe a progress lane, because "how far along is
 * this" is the shape almost every ongoing subject has. Both are optional in
 * effect: an activity with no lane (`steps: []`, `activeStepId: null`) is a
 * perfectly good live entry — a heading, a sentence and a timestamp that keeps
 * moving.
 */

/** One stop on a live activity's lane. */
export interface LiveActivityStep {
  /** Stable across updates — the id is what `activeStepId` names. */
  id: string;
  /** What the reader sees under the dot. The HOST's word, in the reader's language. */
  label: string;
}

/** One thing that is happening right now, as the notification centre shows it. */
export interface LiveActivity {
  /**
   * Stable for the whole life of the subject.
   *
   * The SAME id on every update, because it is the identity of the thing being
   * tracked and not of the message: the panel keys on it so a stage change
   * re-renders one card rather than swapping two, and it is what
   * {@link livePushTag} collapses an OS notification onto.
   *
   * **Unique among the activities live at one moment**, for the same reason:
   * it is the React key and the card's test id. Two activities sharing one
   * gives a duplicate-key warning and a card that silently shows the wrong
   * subject.
   */
  id: string;
  /**
   * Which host concern this belongs to, e.g. `order`, `delivery`, `import`.
   *
   * Free-form and never rendered — it exists so a host publishing from two
   * sources can tell its own activities apart in a test or a log without
   * parsing `id`.
   */
  kind: string;
  /** The heading — what is happening. */
  title: string;
  /** The line under it: the detail that makes the heading actionable, or none. */
  body: string | null;
  /** Where tapping the card goes, as a same-origin path. `null` renders no link. */
  link: string | null;
  /** The lane, in the order it is walked. Empty when this subject has no lane. */
  steps: readonly LiveActivityStep[];
  /**
   * The stop the subject is AT — one of `steps`, or `null` for a laneless entry.
   *
   * An id that names no step is neither, and it is handled rather than trusted:
   * see {@link liveActivityLane}.
   */
  activeStepId: string | null;
  /**
   * ISO-8601 — when the subject last MOVED, not when it was last polled.
   *
   * A timestamp that advances on every read would render "just now" forever,
   * which is the one thing a live entry must not say when nothing is happening.
   */
  updatedAt: string;
}

/** A live activity's lane, resolved for rendering. */
export interface LiveActivityLane {
  steps: readonly LiveActivityStep[];
  activeStepId: string;
  /** Every stop BEFORE the active one — never the active one itself. */
  completed: ReadonlySet<string>;
}

/**
 * The lane to draw, or `null` when this activity has none to draw.
 *
 * Three cases collapse to `null`, and the third is the one worth writing down:
 * no steps, no active step, and **an active step the lane does not contain**.
 * That last one is not a theoretical defect — it is what a host produces the
 * first time a subject reaches a stage the lane was filtered to exclude, and
 * the symptom is a row of dots with NONE of them lit, which reads as a process
 * that has stopped. A card with no lane still says what is happening and when
 * it last moved; a dead lane says the tracking is broken.
 *
 * `completed` deliberately stops short of the active stop: a completed step
 * draws a tick, and ticking the stop the subject is sitting in claims it has
 * already left.
 */
export function liveActivityLane(activity: LiveActivity): LiveActivityLane | null {
  const activeStepId = activity.activeStepId;
  if (activeStepId === null || activity.steps.length === 0) return null;
  const reached = activity.steps.findIndex((step) => step.id === activeStepId);
  if (reached < 0) return null;
  return {
    steps: activity.steps,
    activeStepId,
    completed: new Set(activity.steps.slice(0, reached).map((step) => step.id)),
  };
}

/**
 * The reserved `data` key that ties a NOTIFICATION to a live subject.
 *
 * A notification and a live activity are different objects with different
 * lifetimes, and this is the only thing that joins them: a generator whose
 * event is about something also tracked live puts the activity's id here, and
 * every channel that can collapse gets to.
 *
 *     data: { [LIVE_SUBJECT_KEY]: `order:${orderId}` }
 *
 * A plain string on purpose. An object here would grow a second wire contract
 * inside a column this package stores verbatim.
 */
export const LIVE_SUBJECT_KEY = 'liveSubject';

/**
 * Namespaces the tray tag, so a live tag does not collide with the ones a host
 * already uses.
 *
 * A convention rather than an enforcement — nothing stops a host emitting its
 * own `live:`-prefixed tags — but it means the two id spaces have to be made to
 * meet rather than meeting by accident.
 */
export const LIVE_PUSH_TAG_PREFIX = 'live:';

/**
 * The OS notification tag for a push about a live subject, or `null` for an
 * ordinary event.
 *
 * ## What the tag buys, and why it is the PWA half of this feature
 *
 * A `tag` makes a new notification REPLACE the one already in the tray instead
 * of stacking under it, and — unless the sender asks otherwise — replace it
 * *silently*. So a subject that moves through four stages costs one tray entry
 * and one buzz, and the entry that remains is the CURRENT one. Without it a
 * phone accumulates one alert per stage, all of them still asserting a stage
 * the subject has since left; the freshest is at the top and the reader has to
 * work out that the three below it are history.
 *
 * That is as close as the web platform gets to an ongoing/live notification,
 * and it is the half that reaches a person who does not have the app open —
 * which is most of the time a live activity is live.
 *
 * The id is passed through unchanged: it is the host's, it is already unique
 * per subject, and a hash would make the tray impossible to reason about from a
 * log line.
 */
export function livePushTag(
  data: Readonly<Record<string, unknown>> | null | undefined,
): string | null {
  const subject = data?.[LIVE_SUBJECT_KEY];
  if (typeof subject !== 'string' || subject === '') return null;
  return `${LIVE_PUSH_TAG_PREFIX}${subject}`;
}
