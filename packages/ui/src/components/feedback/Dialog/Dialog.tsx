import CloseIcon from '@mui/icons-material/Close';
import Backdrop from '@mui/material/Backdrop/index.js';
import Box from '@mui/material/Box/index.js';
import MuiDialog from '@mui/material/Dialog/index.js';
import MuiDialogActions from '@mui/material/DialogActions/index.js';
import MuiDialogContent from '@mui/material/DialogContent/index.js';
import MuiDialogTitle from '@mui/material/DialogTitle/index.js';
import Drawer from '@mui/material/Drawer/index.js';
import IconButton from '@mui/material/IconButton/index.js';
import Typography from '@mui/material/Typography/index.js';
import { useTheme } from '@mui/material/styles/index.js';
import React from 'react';

import { hasSpacingSlot, withDialogDefaults } from './Dialog.helpers';
import {
  DIALOG_ACTIONS,
  DIALOG_BODY_PADDING_UNITS,
  DIALOG_CONTENT_PADDING_UNITS,
  DIALOG_HEADER_CHILDREN_PADDING_UNITS,
  DIALOG_TITLE,
  DIALOG_TITLED_BODY_PADDING_TOP_UNITS,
} from './Dialog.metrics';
import { backdropSxOf, variantStylesOf } from './Dialog.styles';
import type {
  DialogActionsProps,
  DialogContentProps,
  DialogHeaderProps,
  DialogProps,
} from './Dialog.types';

/**
 * The padding a dialog gives children that are not managing their own — and the
 * rule that takes it back when it turns out they are.
 *
 * `:has()` is doing what {@link hasSpacingSlot} cannot. A slot passed through a
 * COMPONENT (`<Body />` rendering a `DialogContent`) is invisible to any check
 * on element type: React does not know what a component renders until it has
 * rendered it, and by then the wrapper is already in the tree. The selector
 * asks the question one step later, of the DOM, where the answer exists.
 *
 * `display: contents` rather than `padding: 0`, because the padding is only
 * half of what a wrapper does. The other half is standing between the paper and
 * its children: MUI's `scroll="paper"` makes the paper a flex column with
 * `overflow-y: auto`, so a `DialogContent` that is no longer its direct child
 * cannot be the thing that scrolls — the whole dialog scrolls instead and
 * carries the `DialogActions` off the bottom with it. An element with
 * `display: contents` generates no box at all: its children become the paper's
 * flex items, and its padding is never applied. Both halves, one declaration.
 *
 * A browser without `:has()` falls back to the padded box — the layout this
 * had before, not a broken one.
 */
const BODY_SX = {
  px: DIALOG_BODY_PADDING_UNITS.horizontal,
  pb: DIALOG_BODY_PADDING_UNITS.bottom,
  '&:has(> .MuiDialogContent-root), &:has(> .MuiDialogActions-root)': {
    display: 'contents',
  },
} as const;

/**
 * The dialog body. Consumers that pass raw children (no <DialogContent>) used
 * to render them flush against the paper edges — give them comfortable default
 * padding; <DialogContent>/<DialogActions> users keep managing their own
 * spacing.
 */
function bodyOf(children: React.ReactNode, hasTitle: boolean): React.ReactNode {
  // Read lazily: both slots are declared below this function.
  if (hasSpacingSlot(children, [DialogContent, DialogActions])) return children;
  const pt = hasTitle
    ? DIALOG_BODY_PADDING_UNITS.topUnderTitle
    : DIALOG_BODY_PADDING_UNITS.top;
  return <Box sx={{ ...BODY_SX, pt }}>{children}</Box>;
}

export const Dialog: React.FC<DialogProps> = (rawProps) => {
  const {
    children,
    variant,
    size,
    title,
    description,
    showCloseButton,
    backdrop,
    persistent,
    glass,
    gradient,
    glow,
    pulse,
    borderRadius,
    onClose,
    open,
    dataTestId,
    ...props
  } = withDialogDefaults(rawProps);
  const theme = useTheme();
  const testId = dataTestId || 'dialog';
  const paperSx = variantStylesOf(theme, {
    variant, size, borderRadius, glass, gradient, glow, pulse,
  });

  const handleClose = (event: object, reason: 'backdropClick' | 'escapeKeyDown') => {
    if (persistent && (reason === 'backdropClick' || reason === 'escapeKeyDown')) {
      return;
    }
    onClose?.();
  };

  const header = title ? (
    <DialogHeader
      title={title}
      subtitle={description}
      showCloseButton={showCloseButton}
      onClose={onClose}
      dataTestId={dataTestId}
    />
  ) : null;
  const body = bodyOf(children, Boolean(title));

  if (variant === 'drawer') {
    return (
      <Drawer
        anchor="right"
        open={open}
        onClose={onClose}
        data-testid={testId}
        {...props}
      >
        <Box sx={{ ...paperSx, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {header}
          {body}
        </Box>
      </Drawer>
    );
  }

  return (
    <MuiDialog
      open={open}
      onClose={handleClose}
      fullScreen={variant === 'fullscreen'}
      BackdropComponent={backdrop ? Backdrop : undefined}
      BackdropProps={{ sx: backdropSxOf(theme, glass) }}
      PaperProps={{ sx: paperSx, 'data-testid': testId }}
      {...props}
    >
      {header}
      {body}
    </MuiDialog>
  );
};

export const DialogHeader: React.FC<DialogHeaderProps> = ({
  children,
  title,
  subtitle,
  showCloseButton = true,
  onClose,
  dataTestId,
}) => {
  if (children) {
    return (
      <Box
        sx={{
          p: DIALOG_HEADER_CHILDREN_PADDING_UNITS,
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        {children}
      </Box>
    );
  }

  return (
    <MuiDialogTitle
      data-testid={dataTestId ? `${dataTestId}-title` : 'dialog-title'}
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        pb: subtitle
          ? DIALOG_TITLE.paddingBottomUnits.withSubtitle
          : DIALOG_TITLE.paddingBottomUnits.plain,
      }}
    >
      <Box>
        <Typography variant="h6" component="div">
          {title}
        </Typography>
        {subtitle && (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mt: DIALOG_TITLE.subtitleGapUnits }}
          >
            {subtitle}
          </Typography>
        )}
      </Box>
      {showCloseButton && onClose && (
        <IconButton
          aria-label="close"
          onClick={onClose}
          data-testid={dataTestId ? `${dataTestId}-close` : 'dialog-close'}
          sx={{
            color: 'text.secondary',
            '&:hover': {
              backgroundColor: 'action.hover',
            },
          }}
        >
          <CloseIcon />
        </IconButton>
      )}
    </MuiDialogTitle>
  );
};

/**
 * Top padding for a body that sits directly under the title.
 *
 * MUI zeroes it there (`.MuiDialogTitle-root + &` on a non-`dividers` content),
 * assuming the title's own bottom padding is the whole gap. That assumption
 * breaks for a body opening with an outlined field: a filled field floats its
 * label ABOVE the input's border box, and `DialogContent` is `overflow-y: auto`
 * — a clipping box — so the label gets sliced in half (FUT-544: "Tipo" in the
 * "Novo insumo" dialog).
 *
 * Reserve the overhang rather than restore the full 24px: the title already
 * contributes its bottom padding, so a shrunk label's `translate(…, -9px)` is
 * all that is missing. 12px clears it and leaves the gap visually tight.
 */
const TITLED_BODY_PADDING_TOP = DIALOG_TITLED_BODY_PADDING_TOP_UNITS;

/**
 * `.MuiDialogTitle-root + &` is `(0,2,0)`-specific and a plain `sx` entry is
 * `(0,1,0)`, so the padding above only survives the cascade by naming the class
 * again — `(0,3,0)`. Scoped to the title-following case so an untitled dialog
 * keeps MUI's roomier default.
 */
const TITLED_BODY_SELECTOR = '.MuiDialogTitle-root + &.MuiDialogContent-root';

export const DialogContent: React.FC<DialogContentProps> = ({
  children,
  dividers = false,
  dense = false,
  dataTestId,
  ...props
}) => (
    <MuiDialogContent
      data-testid={dataTestId ? `${dataTestId}-content` : 'dialog-content'}
      dividers={dividers}
      sx={{
        padding: dense ? DIALOG_CONTENT_PADDING_UNITS.dense : DIALOG_CONTENT_PADDING_UNITS.normal,
        [TITLED_BODY_SELECTOR]: { paddingTop: TITLED_BODY_PADDING_TOP },
        '&.MuiDialogContent-dividers': {
          borderTop: dividers ? '1px solid' : 'none',
          borderBottom: dividers ? '1px solid' : 'none',
          borderColor: 'divider',
        },
      }}
      {...props}
    >
      {children}
    </MuiDialogContent>
  );

export const DialogActions: React.FC<DialogActionsProps> = ({
  children,
  alignment = 'right',
  spacing = DIALOG_ACTIONS.defaultSpacingUnits,
  dataTestId,
  ...props
}) => {
  const getJustifyContent = () => {
    switch (alignment) {
      case 'left': return 'flex-start';
      case 'center': return 'center';
      case 'right': return 'flex-end';
      case 'space-between': return 'space-between';
      default: return 'flex-end';
    }
  };

  return (
    <MuiDialogActions
      data-testid={dataTestId ? `${dataTestId}-actions` : 'dialog-actions'}
      sx={{
        justifyContent: getJustifyContent(),
        gap: spacing,
        p: DIALOG_ACTIONS.paddingUnits,
      }}
      {...props}
    >
      {children}
    </MuiDialogActions>
  );
};