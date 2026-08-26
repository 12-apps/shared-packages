'use client';

import Box from '@mui/material/Box/index.js';
import Typography from '@mui/material/Typography/index.js';
import { useTheme } from '@mui/material/styles/index.js';
import useMediaQuery from '@mui/material/useMediaQuery/index.js';
import React from 'react';

import { accentFor } from '../../../tokens/scales';
import { Sheet } from '../../data-display/Sheet/Sheet';
import { Button } from '../../form/Button/Button';
import { Dialog } from '../../feedback/Dialog/Dialog';

import type {
  AppHeaderDetailRow,
  AppHeaderDetailsAction,
  AppHeaderDetailsProps,
} from './AppHeader.types';

/** How wide the dialog presentation grows before it stops. */
const DIALOG_WIDTH = 460;

/**
 * Where the smallest phones stop. The theme's scale starts at `xs`/`sm`, so
 * there is no `xxs` breakpoint to ask for — this is that boundary, named once
 * rather than inlined at the place it decides something.
 */
const XXS_MAX_WIDTH = 360;

/**
 * The sheet grows to its content and stops at the viewport; it does not take a
 * fixed slab of height.
 *
 * `Sheet`'s vertical presets are absolute (`md` is 400px), which on a phone is
 * shorter than six detail rows plus a button — so the panel scrolled INSIDE a
 * screen that had room to spare, putting the address and the way out below the
 * fold of a sheet using two thirds of the display. `height: auto` sizes it to
 * what is in it, and the cap keeps a long panel on-screen: 100dvh on the
 * smallest phones where every pixel counts, 90dvh above that so the panel still
 * reads as a sheet over a page rather than as a new screen.
 *
 * `dvh` and not `vh` — mobile browser chrome makes `vh` overshoot, which would
 * reintroduce exactly the scroll this removes.
 */
function sheetHeight(xxs: boolean): { height: string; maxHeight: string } {
  return { height: 'auto', maxHeight: xxs ? '100dvh' : '90dvh' };
}

/** Which surface this viewport calls for. Lifted out to keep the component lean. */
function usesSheet(presentation: AppHeaderDetailsProps['presentation'], compact: boolean): boolean {
  if (presentation === 'sheet') return true;
  if (presentation === 'dialog') return false;
  return compact;
}

/** One label/value line. The value may wrap to two lines; the label may not. */
const DetailRow: React.FC<{ row: AppHeaderDetailRow; last: boolean; dataTestId: string }> = ({
  row,
  last,
  dataTestId,
}) => {
  const theme = useTheme();
  return (
    <Box
      data-testid={`${dataTestId}-row`}
      data-row={row.id ?? row.label}
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 2,
        py: 1.5,
        borderBottom: last ? 'none' : `1px solid ${theme.palette.divider}`,
      }}
    >
      <Typography variant="body1" color="text.secondary" component="span" sx={{ flex: '0 0 auto' }}>
        {row.label}
      </Typography>
      <Typography
        variant="body1"
        component="span"
        sx={{
          minWidth: 0,
          textAlign: 'right',
          fontWeight: row.tone ? 700 : 500,
          color: row.tone ? accentFor(theme, row.tone).main : 'text.primary',
          // Newlines in a value are meaningful — an address is two lines.
          whiteSpace: 'pre-line',
        }}
      >
        {row.value}
      </Typography>
    </Box>
  );
};

/** The rows plus whatever the caller put under them. */
const DetailsBody: React.FC<
  Pick<AppHeaderDetailsProps, 'rows' | 'children'> & { dataTestId: string }
> = ({ rows, children, dataTestId }) => (
  <Box data-testid={`${dataTestId}-body`}>
    {(rows ?? []).map((row, index) => (
      <DetailRow
        key={row.id ?? row.label}
        row={row}
        last={index === (rows?.length ?? 0) - 1 && !children}
        dataTestId={dataTestId}
      />
    ))}
    {children}
  </Box>
);

/**
 * The single full-width call to action, or nothing.
 *
 * `padded` is for the dialog, which has no footer slot of its own — and the
 * padding lives here rather than at the call site so an action-less panel does
 * not end in a strip of empty space.
 */
const DetailsAction: React.FC<{
  action?: AppHeaderDetailsAction;
  dataTestId: string;
  padded?: boolean;
}> = ({ action, dataTestId, padded = false }) =>
  action ? (
    <Box sx={padded ? { pt: 2 } : undefined}>
      <Button
        variant="solid"
        color={action.color ?? 'primary'}
        size="lg"
        fullWidth
        disabled={action.disabled}
        onClick={action.onClick}
        dataTestId={action.dataTestId ?? `${dataTestId}-action`}
      >
        {action.label}
      </Button>
    </Box>
  ) : null;

/**
 * The panel behind the header's disclosure — the hours, the address, the way
 * out — in the shape the viewport calls for.
 *
 * ONE component with two presentations, because they are one thing to the user
 * and one thing to the caller: a bottom sheet within reach of a thumb, a centred
 * dialog under a pointer. `auto` picks by viewport, so nobody writes that branch
 * at a call site and nobody ships a phone-shaped sheet stretched across a
 * desktop. Force either one with `presentation` when the surrounding layout
 * already decides (a preview frame, a story, a kiosk).
 */
export const AppHeaderDetails: React.FC<AppHeaderDetailsProps> = ({
  open,
  onClose,
  title,
  subtitle,
  rows,
  children,
  action,
  presentation = 'auto',
  breakpoint = 'sm',
  className,
  dataTestId = 'app-header-details',
}) => {
  const theme = useTheme();
  const asSheet = usesSheet(presentation, useMediaQuery(theme.breakpoints.down(breakpoint)));
  const xxs = useMediaQuery(`(max-width:${XXS_MAX_WIDTH - 0.05}px)`);

  // Split once, not per branch: a STRING subtitle is the panel's own
  // `description` (both surfaces style it as part of their header), anything
  // richer is a node we render ourselves above the rows.
  const description = typeof subtitle === 'string' ? subtitle : undefined;
  const richSubtitle = description === undefined ? subtitle : null;

  const body = (
    <DetailsBody rows={rows} dataTestId={dataTestId}>
      {children}
    </DetailsBody>
  );
  const footer = <DetailsAction action={action} dataTestId={dataTestId} />;

  if (asSheet) {
    // No `showHandle`. The grab bar promises a drag this panel does not answer:
    // its height is its content's, so there is no second position to drag it
    // to, and the handle sat above a ✕ that already closes it. Swipe-to-dismiss
    // is `Sheet`'s default and still works — it just stops being advertised by
    // a control that looked resizable and was not.
    return (
      <Sheet
        open={open}
        onClose={onClose}
        onOpenChange={(next) => !next && onClose()}
        position="bottom"
        size="md"
        style={sheetHeight(xxs)}
        className={className}
        title={title}
        description={description}
        showCloseButton
        rounded
        footer={footer}
        dataTestId={dataTestId}
      >
        {richSubtitle}
        {body}
      </Sheet>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      showCloseButton
      fullWidth
      className={className}
      dataTestId={dataTestId}
      PaperProps={{ sx: { maxWidth: DIALOG_WIDTH, borderRadius: 3 } }}
    >
      {richSubtitle}
      {body}
      <DetailsAction action={action} dataTestId={dataTestId} padded />
    </Dialog>
  );
};

AppHeaderDetails.displayName = 'AppHeaderDetails';
