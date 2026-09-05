/**
 * ONE pinned live entry: a mark, what is happening, its lane, and when it last
 * moved.
 *
 * Visually a WASH rather than a fill — a tinted card with a brand-tinted border
 * — for the reason the inbox's unread row uses the same treatment: this sits at
 * the top of a list of other people's news, and a saturated block there
 * out-shouts everything it is supposed to be introducing.
 *
 * ## The card is a DIV, and the button is inside it
 *
 * The obvious shape — one `<button>` wrapping the whole card — is not
 * available, because `Stepper` draws every stop as a real `<button>`
 * (`@12-apps/ui`'s `StepButton` is `styled(Button)`), and `clickable={false}`
 * only sets `pointer-events: none`. A button inside a button is invalid HTML:
 * the parser auto-closes the outer one at the first nested one, so any host
 * that server-renders the panel open hydrates against a tree the browser
 * rewrote, and every adopter's dev console carries a React error besides.
 *
 * `aria-hidden` and `inert` on the lane fix the tab stops and the accessible
 * name — they do NOT fix the nesting, and an earlier draft of this file claimed
 * they did. So the tap target is the TEXT block, and the lane and the timestamp
 * are its siblings: valid markup, and a target that still covers everything a
 * reader would aim at.
 */
import { useId, type JSX, type ReactNode } from 'react';

import { Stepper } from '@12-apps/ui/data-display/Stepper';
import { Box } from '@12-apps/ui/mui/Box';
import { alpha, type Theme } from '@12-apps/ui/mui/styles';
import { Text } from '@12-apps/ui/typography/Text';

import { liveActivityLane, type LiveActivity } from '../live';
import type { NotificationMessages } from '../messages';

import type { LiveActivitiesConfig, LiveActivityMessages } from './live-config';
import { relativeTime } from './relative-time';

const cardSx = {
  // `relative`, so the button below can stretch a hit area over the whole card
  // — see `targetSx`.
  position: 'relative',
  border: '1px solid',
  borderColor: (t: Theme) => alpha(t.palette.primary.main, 0.35),
  bgcolor: (t: Theme) => alpha(t.palette.primary.main, 0.06),
  borderRadius: 1.5,
  p: 1.25,
  mb: 1,
} as const;

/** The text block: the mark, the heading and the sentence under it. */
const targetSx = {
  display: 'flex',
  alignItems: 'center',
  gap: 1,
  width: '100%',
  textAlign: 'left',
  font: 'inherit',
  color: 'inherit',
  border: 'none',
  background: 'none',
  p: 0,
} as const;

/**
 * The button, stretched over the WHOLE card.
 *
 * Taking the lane out of the link fixed the markup and left the card looking
 * like one target while only its top half was one — the lane is the most
 * visually distinctive part of it, and its own step buttons carry
 * `pointer-events: none`, so aiming at the obvious thing did nothing.
 *
 * A stretched pseudo-element is the remedy that keeps the structure: the
 * `<button>` stays a sibling of the lane in the tree, so nothing nests, and its
 * `::after` covers the card. `z-index: 0` on the lane and the timestamp is not
 * needed — they paint after the button in document order and the overlay is the
 * button's own child, which is what puts it on top of both.
 */
const stretchedSx = {
  ...targetSx,
  cursor: 'pointer',
  '&::after': { content: '""', position: 'absolute', inset: 0 },
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
 * `aria-hidden` AND `inert`: the stops are real buttons, and leaving four
 * focusable, named controls per entry in front of an inbox would cost a
 * keyboard user the list they opened the panel for. Nothing is lost by hiding
 * it — the stop the subject is at is already the card's heading, and the row of
 * dots restates it visually.
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

/** Not exported: the card is composed by `LiveSection`, which owns the clock. */
interface LiveActivityCardProps {
  activity: LiveActivity;
  messages: NotificationMessages;
  live: LiveActivityMessages;
  renderIcon?: LiveActivitiesConfig['renderIcon'];
  /** The clock this render reads, so the "last moved" line can be ticked. */
  now: number;
  /**
   * Follow the card's link.
   *
   * Absent — as it is for a host with no router — renders the text as text. A
   * named, focusable control that does nothing is worse than no control.
   */
  onOpen?: (activity: LiveActivity) => void;
}

/** The mark on the left, when the host draws one. */
function ActivityIcon({ icon }: { icon: ReactNode }): JSX.Element | null {
  if (icon === undefined || icon === null) return null;
  return (
    <Box aria-hidden sx={{ display: 'flex', flex: '0 0 auto', color: 'primary.main' }}>
      {icon}
    </Box>
  );
}

/** The mark, the heading and the line under it. */
function ActivityTarget({
  activity,
  renderIcon,
  bodyId,
}: Pick<LiveActivityCardProps, 'activity' | 'renderIcon'> & {
  /** Ties the sentence to the button, so a label does not swallow it. */
  bodyId: string;
}): JSX.Element {
  return (
    <>
      <ActivityIcon icon={renderIcon?.(activity)} />
      {/* A COLUMN, not a bare block: `Text` sets no `display`, so two adjacent
          spans in an ordinary div run together on one line with not even a
          space between them — which is how the heading and the sentence under
          it ended up as one word in an earlier draft. `row.tsx` gets this right
          the same way. */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, minWidth: 0 }}>
        {/*
          The live region is THIS LINE and nothing else. The card also carries a
          relative timestamp that moves every minute for as long as the subject
          lasts, and announcing that is a polite interruption per minute for
          news the reader did not ask to be read. What is worth interrupting for
          is the subject MOVING, which is what the heading says.
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
          <Text id={bodyId} variant="caption" size="xs" color="secondary" as="span">
            {activity.body}
          </Text>
        )}
      </Box>
    </>
  );
}

export function LiveActivityCard({
  activity,
  messages,
  live,
  renderIcon,
  now,
  onOpen,
}: LiveActivityCardProps): JSX.Element {
  const followable = activity.link !== null && onOpen !== undefined;
  const bodyId = useId();
  const target = (
    <ActivityTarget
      activity={activity}
      bodyId={bodyId}
      {...(renderIcon ? { renderIcon } : {})}
    />
  );
  return (
    <Box data-testid={`live-activity-${activity.id}`} sx={cardSx}>
      {followable ? (
        <Box
          component="button"
          type="button"
          onClick={() => onOpen(activity)}
          // `aria-label` REPLACES the contents, so the sentence under the
          // heading — the detail that makes the heading actionable — would be
          // announced to nobody. `aria-describedby` puts it back.
          aria-label={live.openActivity(activity.title)}
          {...(activity.body === null ? {} : { 'aria-describedby': bodyId })}
          data-testid={`live-activity-open-${activity.id}`}
          sx={stretchedSx}
        >
          {target}
        </Box>
      ) : (
        <Box sx={targetSx}>{target}</Box>
      )}
      <ActivityLane activity={activity} />
      <Text variant="caption" size="xs" color="secondary" as="span" italic>
        {live.updated(relativeTime(activity.updatedAt, messages, now))}
      </Text>
    </Box>
  );
}
