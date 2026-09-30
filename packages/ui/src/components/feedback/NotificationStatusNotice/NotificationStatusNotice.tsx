import Box from '@mui/material/Box/index.js';
import Typography from '@mui/material/Typography/index.js';
import React from 'react';

import { Alert } from '../../data-display/Alert/Alert';
import { Button } from '../../form/Button/Button';
import { NOTICE_VARIANT } from './NotificationStatusNotice.helpers';
import {
  NOTICE_ACTION_GAP_UNITS,
  NOTICE_STEP_GAP_UNITS,
  NOTICE_STEPS_INDENT_UNITS,
} from './NotificationStatusNotice.metrics';
import type {
  BlockedNoticeProps,
  DisabledNoticeProps,
  NotificationStatusNoticeProps,
} from './NotificationStatusNotice.types';

const DEFAULT_TEST_ID = 'notification-status-notice';

const EnableAction: React.FC<{ props: DisabledNoticeProps; testId: string }> = ({
  props,
  testId,
}) => (
  <Box sx={{ mt: NOTICE_ACTION_GAP_UNITS }}>
    <Button
      variant="solid"
      color="primary"
      size="sm"
      // `loading` also disables the button, so a second tap cannot ask twice.
      loading={props.pending}
      onClick={props.onEnable}
      dataTestId={`${testId}-enable`}
    >
      {props.enableLabel}
    </Button>
  </Box>
);

/**
 * The way back from a refusal: a disclosure over the steps, because the steps
 * are long and most readers of a blocked notice will not act on it right now.
 * A real button with `aria-expanded`, so a screen reader hears that it opens
 * something and whether it has.
 */
const BlockedSteps: React.FC<{ props: BlockedNoticeProps; testId: string }> = ({
  props,
  testId,
}) => {
  const [open, setOpen] = React.useState(props.defaultStepsOpen ?? false);
  const listId = React.useId();

  return (
    <Box sx={{ mt: NOTICE_ACTION_GAP_UNITS }}>
      <Button
        variant="text"
        color="primary"
        size="sm"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((was) => !was)}
        dataTestId={`${testId}-steps-toggle`}
      >
        {props.stepsToggleLabel}
      </Button>
      <Box
        component="ol"
        id={listId}
        hidden={!open}
        data-testid={`${testId}-steps`}
        sx={{
          m: 0,
          mt: NOTICE_STEP_GAP_UNITS,
          pl: NOTICE_STEPS_INDENT_UNITS,
          display: open ? 'flex' : 'none',
          flexDirection: 'column',
          gap: NOTICE_STEP_GAP_UNITS,
        }}
      >
        {props.steps.map((step, index) => (
          <Typography key={`${index}-${step}`} component="li" variant="body2">
            {step}
          </Typography>
        ))}
      </Box>
    </Box>
  );
};

const NoticeAction: React.FC<{ props: NotificationStatusNoticeProps; testId: string }> = ({
  props,
  testId,
}) => {
  if (props.status === 'disabled') return <EnableAction props={props} testId={testId} />;
  if (props.status === 'blocked') return <BlockedSteps props={props} testId={testId} />;
  return null;
};

/**
 * Tells a reader whether this browser will notify them, and gives them the one
 * thing they can do about it: a tap that asks (`disabled`), the steps that
 * undo a refusal (`blocked`), or nothing when nothing can change (`enabled`,
 * `unavailable`).
 *
 * Every word is the host's. The component decides only the shape and how loud
 * each status is — see `NOTICE_VARIANT`.
 */
export const NotificationStatusNotice = React.forwardRef<
  HTMLDivElement,
  NotificationStatusNoticeProps
>((props, ref) => {
  const testId = props.dataTestId ?? DEFAULT_TEST_ID;

  return (
    <Alert
      ref={ref}
      variant={NOTICE_VARIANT[props.status]}
      title={props.title}
      description={props.description}
      // A status line, not an interruption: it must not cut across whatever
      // the screen reader is saying about the page it sits on.
      announce="polite"
      showIcon
      data-testid={testId}
      data-status={props.status}
      className={props.className}
      sx={props.sx}
    >
      <NoticeAction props={props} testId={testId} />
    </Alert>
  );
});

NotificationStatusNotice.displayName = 'NotificationStatusNotice';
