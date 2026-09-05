/**
 * ONE pinned live entry: a mark, what is happening, its lane, and when it last
 * moved.
 *
 * Visually a WASH rather than a fill — a tinted card with a brand-tinted border
 * — for the reason the inbox's unread row uses the same treatment: this sits at
 * the top of a list of other people's news, and a saturated block there
 * out-shouts everything it is supposed to be introducing.
 */
import type { JSX } from 'react';

import { Stepper } from '@12-apps/ui/data-display/Stepper';
import { Box } from '@12-apps/ui/mui/Box';
import { alpha, type Theme } from '@12-apps/ui/mui/styles';
import { Text } from '@12-apps/ui/typography/Text';

import { liveActivityLane, type LiveActivity } from '../live';
import type { NotificationMessages } from '../messages';

import type { LiveActivitiesConfig, LiveActivityMessages } from './live-config';
import { relativeTime } from './relative-time';

const cardSx = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  font: 'inherit',
  color: 'inherit',
  border: '1px solid',
  borderColor: (t: Theme) => alpha(t.palette.primary.main, 0.35),
  bgcolor: (t: Theme) => alpha(t.palette.primary.main, 0.06),
  borderRadius: 1.5,
  p: 1.25,
  mb: 1,
} as const;

/**
 * Make a four-stop lane fit the panel.
 *
 * The drawer is 400px on a desktop and the full viewport on a phone, so the
 * narrow case is ~320px of card minus its padding. `Stepper` renders its labels
 * at `body2` for every size but `sm` and reserves 24px of connector plus 8px of
 * margin on each side, which is more row than four short words have — measured
 * on a 320px viewport, the last stop hung off the edge and the DRAWER scrolled
 * sideways.
 *
 * Three overrides, each buying back a specific number of pixels: 11px labels, a
 * step column allowed to shrink below the package's 44px floor (so the row's
 * min-content width is the longest WORD rather than the longest phrase), and
 * thinner connectors. `overflow: hidden` is the backstop and not the mechanism
 * — a locale with longer words than any of this anticipates clips its own card
 * instead of making the panel scroll.
 */
const laneSx = {
  pt: 1.25,
  px: 0.5,
  overflow: 'hidden',
  '& .MuiTypography-root': { fontSize: 11, lineHeight: 1.25 },
  '& [data-testid^="stepper-step-content-"]': { minWidth: 0 },
  '& [data-testid^="stepper-connector-"]': { minWidth: 6, mx: 0.75 },
} as const;

/**
 * The lane, or nothing.
 *
 * `aria-hidden` AND `inert`, because `Stepper` draws each stop as a real
 * `<button>` and `clickable={false}` only sets `pointer-events: none` — it
 * leaves them focusable and named. Inside this card's own button that is
 * invalid HTML, a handful of dead tab stops per live entry, and an accessible
 * name that absorbs "Step 1: … (completed)" once per stop. Nothing is lost by
 * hiding it, which is what makes this the fix rather than a trade: the stop the
 * subject is at is already the card's heading, and the row of dots restates it
 * visually.
 */
function ActivityLane({ activity }: { activity: LiveActivity }): JSX.Element | null {
  const lane = liveActivityLane(activity);
  if (lane === null) return null;
  return (
    <Box sx={laneSx} aria-hidden inert>
      <Stepper
        steps={lane.steps.map((step) => ({ id: step.id, label: step.label }))}
        activeId={lane.activeStepId}
        completed={new Set(lane.completed)}
        orientation="horizontal"
        size="xs"
        clickable={false}
        data-testid={`live-activity-steps-${activity.id}`}
      />
    </Box>
  );
}

export interface LiveActivityCardProps {
  activity: LiveActivity;
  messages: NotificationMessages;
  live: LiveActivityMessages;
  renderIcon?: LiveActivitiesConfig['renderIcon'];
  /** The clock this render reads, so the "last moved" line can be ticked. */
  now: number;
  /** Follow the card's link. Absent (or a `null` link) renders plain text. */
  onOpen?: (activity: LiveActivity) => void;
}

/** The card's contents — shared by the link and the plain forms. */
function CardBody({
  activity,
  messages,
  live,
  renderIcon,
  now,
}: Omit<LiveActivityCardProps, 'onOpen'>): JSX.Element {
  const icon = renderIcon?.(activity);
  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        {icon === undefined || icon === null ? null : (
          <Box aria-hidden sx={{ display: 'flex', flex: '0 0 auto', color: 'primary.main' }}>
            {icon}
          </Box>
        )}
        <Box sx={{ minWidth: 0 }}>
          {/*
            The live region is THIS LINE and nothing else. The card also carries
            a relative timestamp that moves every minute for as long as the
            subject lasts, and announcing that is a polite interruption per
            minute for news the reader did not ask to be read. What is worth
            interrupting for is the subject MOVING, which is what the heading
            says.
          */}
          <Text
            variant="body"
            size="sm"
            weight="semibold"
            as="span"
            aria-live="polite"
            data-testid={`live-activity-title-${activity.id}`}
          >
            {activity.title}
          </Text>
          {activity.body === null ? null : (
            <Text variant="caption" size="xs" color="secondary" as="span">
              {activity.body}
            </Text>
          )}
        </Box>
      </Box>
      <ActivityLane activity={activity} />
      <Text variant="caption" size="xs" color="secondary" as="span" italic>
        {live.updated(relativeTime(activity.updatedAt, messages, now))}
      </Text>
    </>
  );
}

export function LiveActivityCard({ onOpen, ...body }: LiveActivityCardProps): JSX.Element {
  const { activity, live } = body;
  const followable = activity.link !== null && onOpen !== undefined;
  return (
    <Box
      {...(followable
        ? {
            component: 'button' as const,
            type: 'button' as const,
            onClick: () => onOpen(activity),
            'aria-label': live.openActivity(activity.title),
          }
        : {})}
      data-testid={`live-activity-${activity.id}`}
      sx={{ ...cardSx, cursor: followable ? 'pointer' : 'default' }}
    >
      <CardBody {...body} />
    </Box>
  );
}
