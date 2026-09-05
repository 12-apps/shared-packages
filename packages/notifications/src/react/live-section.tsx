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
 * - It does not touch `unread`. A live entry is not news; counting it would put
 *   a number on the bell that no amount of reading can clear.
 * - It renders nothing at all when there is nothing live — no heading, no empty
 *   state, no reserved space. A panel with one permanent empty section in it is
 *   a panel that has taught its reader to skip the top.
 * - It does not fetch. `useActivities` is the host's, and `active` tells it
 *   whether anyone is looking.
 */
import { useEffect, useId, useState, type JSX } from 'react';

import { Box } from '@12-apps/ui/mui/Box';
import { Text } from '@12-apps/ui/typography/Text';

import type { LiveActivity } from '../live';
import type { NotificationMessages } from '../messages';

import { LiveActivityCard } from './live-card';
import type { LiveActivitiesConfig } from './live-config';

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

/** The current minute, re-read on a timer while `active`. */
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
}



export function LiveSection({
  config,
  messages,
  active,
  onOpen,
}: LiveSectionProps): JSX.Element | null {
  // Unconditional, because it is a hook. `active` is how it is told nobody is
  // looking — the same arrangement `useSignal` has one seam over.
  const activities = config.useActivities({ active });
  const now = useMinuteTick(active && activities.length > 0);
  // Per MOUNT, not per module: `LiveSection` is exported, and a host with a
  // desktop and a mobile panel would otherwise emit one id twice and have both
  // regions resolve their label to whichever came first.
  const headingId = useId();

  if (activities.length === 0) return null;

  return (
    // A NAMED region. Without the label a screen-reader user meets a loose run
    // of controls ahead of the inbox with nothing saying what they are; the
    // panel's own title is the drawer's heading and cannot describe this block.
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
  );
}
