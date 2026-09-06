/**
 * The pinned block at the top of the panel: everything that is happening NOW,
 * above everything that has already happened.
 *
 * ## Why it is here and not a second surface
 *
 * The notification centre is where a person goes to find out what they missed.
 * Splitting "happening" into its own bell would make them check two places to
 * answer one question, and the half they would stop checking is the one that
 * only has something in it occasionally — which is this one. Above the list,
 * inside the same drawer, it is on the path they already walk.
 *
 * ## What it deliberately does NOT do
 *
 * - It does not mark anything READ. A live entry counts on the bell, but as
 *   itself rather than as unread — the tone, not the number, is what says
 *   whether it is news. (This once read "it does not touch `unread`", on the
 *   argument that counting it would put a number on the bell no amount of
 *   reading can clear. The argument stands; the tone is what answers it.)
 * - It renders no heading, no empty state and no reserved space when there is
 *   nothing live — but it still renders its SLOT, so the inbox below keeps its
 *   position and is not torn down and rebuilt every time a subject starts or
 *   finishes.
 * - It does not fetch. `useActivities` is the host's, and `active` tells it
 *   whether anyone is looking.
 */
import { useEffect, useId, useState, type JSX, type ReactNode } from 'react';

import { Box } from '@12-apps/ui/mui/Box';
import { Text } from '@12-apps/ui/typography/Text';

import type { LiveActivity } from '../live';
import type { NotificationMessages } from '../messages';

import { LiveActivityCard } from './live-card';
import type { LiveActivitiesConfig } from './live-config';
import type { LiveSeenStore } from './live-seen';

/**
 * How often the section re-reads the clock.
 *
 * Every minute, because the timestamps under the cards are in minutes and a
 * tick that cannot change what is on screen is a wasted render — which is why
 * it is gated on there being something to tick as well as on the panel being
 * open. An open panel with nothing live schedules nothing at all; the earlier
 * gate was `active` alone, and it re-rendered a section that renders `null`
 * once a minute for as long as somebody left the inbox open.
 */
const TICK_MS = 60_000;

/**
 * The current minute, re-read on a timer while there is something to tick.
 *
 * The caller passes `active && there are activities` — see {@link TICK_MS} for
 * why both halves are in it.
 */
function useMinuteTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    // Re-read once on becoming active too: a panel reopened after ten minutes
    // would otherwise show the minute it was closed at until the first tick.
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

export interface LiveSectionProps {
  config: LiveActivitiesConfig;
  messages: NotificationMessages;
  /** Whether the panel is open — passed straight through to the host's hook. */
  active: boolean;
  /**
   * Follow a card's link.
   *
   * Optional, and the panel omits it for a host with no router: a card that
   * cannot go anywhere renders as text rather than as a named control that
   * does nothing.
   */
  onOpen?: (activity: LiveActivity) => void;
  /**
   * The rest of the panel, given how many entries are live.
   *
   * A render prop rather than a sibling, because the count is knowable only
   * where the host's hook is CALLED, and it cannot be called anywhere else:
   * `live` is optional on the panel, so reading it there would mean calling a
   * hook conditionally — the failure React reports as a crash in some unrelated
   * component.
   *
   * The inbox needs the number for exactly one decision, and it is the decision
   * this section exists to inform: whether "no notifications" is true. A live
   * entry IS a notification, so a panel showing one under that sentence is
   * contradicting itself.
   */
  children?: (liveCount: number) => ReactNode;
  /**
   * Where "the reader has seen these" is recorded, for the bell to read.
   *
   * Written HERE because this is the component that puts them on screen, and
   * being on screen is what seen means. Optional so the section stays usable by
   * a host that mounts it outside the panel.
   */
  seen?: LiveSeenStore;
}



/**
 * ## Why this always renders its slot, even with nothing live
 *
 * React reconciles a fragment's children POSITIONALLY. The section and the
 * inbox are siblings in one fragment, and the empty branch used to render the
 * inbox ALONE — one child rather than two — so the inbox moved to a position
 * previously held by a different element type, which React handles by
 * unmounting the old subtree and mounting a new one. Every `NotificationRow`
 * would be torn down and rebuilt the moment a pedido started or finished,
 * throwing keyboard focus to `<body>` inside a focus-trapped drawer, for a
 * reader who was only scrolling their inbox.
 *
 * So the empty case renders `null` INTO the slot rather than returning early.
 * Pinned by comparing the row's DOM NODE across the transition: a test on the
 * test id alone passes either way, because a remounted row has the same id.
 */
export function LiveSection({
  config,
  messages,
  active,
  onOpen,
  children,
  seen,
}: LiveSectionProps): JSX.Element {
  // Unconditional, because it is a hook. `active` is how it is told nobody is
  // looking — the same arrangement `useSignal` has one seam over.
  const activities = config.useActivities({ active });
  const now = useMinuteTick(active && activities.length > 0);
  // Per MOUNT, not per module: `LiveSection` is exported, and a host with a
  // desktop and a mobile panel would otherwise emit one id twice and have both
  // regions resolve their label to whichever came first.
  const headingId = useId();

  const liveCount = activities.length;

  // Only while somebody is looking. The panel keeps this mounted through the
  // closing transition, and marking there would swallow an update that arrived
  // in the frames after the reader turned away.
  useEffect(() => {
    if (active && liveCount > 0) seen?.mark(activities);
  }, [active, liveCount, activities, seen]);

  return (
    <>
      {/* A NAMED region, and always a SLOT — see the docblock above. */}
      {liveCount === 0 ? null : (
        <Box
      component="section"
      aria-labelledby={headingId}
      data-testid="live-activities"
      sx={{ pb: 1.5 }}
    >
      {/*
        A SPAN, not a heading. `aria-labelledby` names the region perfectly well
        from one, and an `<h2>` here would sit under the drawer's own `<h6>`
        title and ABOVE the inbox's `<h3>` empty state — an outline in which the
        inbox's states read as part of the live block, which is the opposite of
        what the two blocks are.
      */}
      <Text
        id={headingId}
        variant="caption"
        size="xs"
        color="secondary"
        weight="semibold"
        as="span"
      >
        {config.messages.sectionTitle}
      </Text>
      <Box sx={{ pt: 0.75 }}>
        {activities.map((activity) => (
          <LiveActivityCard
            key={activity.id}
            activity={activity}
            messages={messages}
            live={config.messages}
            now={now}
            {...(onOpen ? { onOpen } : {})}
            {...(config.renderIcon ? { renderIcon: config.renderIcon } : {})}
          />
            ))}
          </Box>
        </Box>
      )}
      {children?.(liveCount)}
    </>
  );
}
