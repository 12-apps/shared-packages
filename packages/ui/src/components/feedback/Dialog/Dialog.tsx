import CloseIcon from '@mui/icons-material/Close';
import {
  Backdrop,
  Box,
  Dialog as MuiDialog,
  DialogActions as MuiDialogActions,
  DialogContent as MuiDialogContent,
  DialogTitle as MuiDialogTitle,
  Drawer,
  IconButton,
  Typography,
  useTheme,
} from '@mui/material';
import React from 'react';

import { backdropSxOf, variantStylesOf } from './Dialog.styles';
import type {
  DialogActionsProps,
  DialogContentProps,
  DialogHeaderProps,
  DialogProps,
} from './Dialog.types';

/**
 * Does this hand us a spacing slot? Fragments are transparent: `<>` is a way of
 * passing several children, not a child that owns them, and a consumer who
 * groups a `DialogContent` and a `DialogActions` in one has still passed both.
 *
 * Only the slots themselves count, and only at the top. A `DialogContent`
 * genuinely nested inside a `<div>` is that div's content, and the dialog
 * padding the div is right.
 */
function hasSpacingSlot(children: React.ReactNode): boolean {
  return React.Children.toArray(children).some((child) => {
    if (!React.isValidElement(child)) return false;
    if (child.type === DialogContent || child.type === DialogActions) return true;
    if (child.type !== React.Fragment) return false;
    return hasSpacingSlot((child.props as { children?: React.ReactNode }).children);
  });
}

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
  px: 3,
  pb: 2.5,
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
  if (hasSpacingSlot(children)) return children;
  return <Box sx={{ ...BODY_SX, pt: hasTitle ? 0.5 : 2.5 }}>{children}</Box>;
}

const DIALOG_DEFAULTS = {
  variant: 'default',
  size: 'md',
  showCloseButton: true,
  backdrop: true,
  persistent: false,
  glass: false,
  gradient: false,
  glow: false,
  pulse: false,
  borderRadius: 'lg',
} as const satisfies Partial<DialogProps>;

/** DialogProps with every defaulted field guaranteed present (wide types). */
type DialogPropsWithDefaults = DialogProps &
  Required<Pick<DialogProps, keyof typeof DIALOG_DEFAULTS>>;

/**
 * Apply {@link DIALOG_DEFAULTS} exactly like parameter defaults would: only a
 * missing/`undefined` prop falls back (a loop, so the component's cyclomatic
 * complexity doesn't pay one branch per defaulted prop).
 */
function withDialogDefaults(props: DialogProps): DialogPropsWithDefaults {
  const merged: Record<string, unknown> = { ...props };
  for (const [key, value] of Object.entries(DIALOG_DEFAULTS)) {
    if (merged[key] === undefined) merged[key] = value;
  }
  return merged as unknown as DialogPropsWithDefaults;
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
      <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
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
        pb: subtitle ? 1 : 2,
      }}
    >
      <Box>
        <Typography variant="h6" component="div">
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
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
const TITLED_BODY_PADDING_TOP = 1.5;

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
        padding: dense ? 1.5 : 3,
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
  spacing = 1,
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
        p: 2,
      }}
      {...props}
    >
      {children}
    </MuiDialogActions>
  );
};