/**
 * The host's controls on a row, drawn BESIDE the row's own target.
 *
 * Shared by the inbox rows and the attention list so both slots keep one
 * layout: every width decision is a CONTAINER query on the slot, never the
 * viewport, so a 400 px drawer and a 286 px popover are each judged by the room
 * they actually have.
 */
import type { JSX, ReactNode } from 'react';

import { Box } from '@12-apps/ui/mui/Box';

/** The container width under which each action takes the whole row. */
const STACK_BELOW = '15rem';
/** The container width under which a control is held to the 40 px touch floor. */
const TOUCH_BELOW = '600px';

const slotSx = {
  flexBasis: '100%',
  minWidth: 0,
  containerType: 'inline-size',
} as const;

const rowSx = {
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'flex-start',
  alignItems: 'center',
  gap: 1,
  minWidth: 0,
  '& > *': { minWidth: 0, maxWidth: '100%' },
  [`@container (max-width: ${STACK_BELOW})`]: {
    '& > *': { flex: '1 1 100%' },
  },
  [`@container (max-width: ${TOUCH_BELOW})`]: {
    '& button, & a, & [role="button"]': { minHeight: 40, minWidth: 40 },
  },
} as const;

/** `null`, `undefined` and booleans draw nothing: the row stays as it was. */
export function hasActions(actions: ReactNode): boolean {
  return actions !== null && actions !== undefined && typeof actions !== 'boolean';
}

/**
 * A sibling of the row's target, after it in tab order: a control here is never
 * nested in the target and a click here never reaches it.
 */
export function RowActionsSlot({
  label,
  testId,
  children,
}: {
  label: string;
  testId: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <Box sx={slotSx}>
      <Box role="group" aria-label={label} data-testid={testId} sx={rowSx}>
        {children}
      </Box>
    </Box>
  );
}
