import { Close as CloseIcon } from '@mui/icons-material';
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
 * The dialog body. Consumers that pass raw children (no <DialogContent>) used
 * to render them flush against the paper edges — give them comfortable default
 * padding; <DialogContent>/<DialogActions> users keep managing their own
 * spacing.
 */
function bodyOf(children: React.ReactNode, hasTitle: boolean): React.ReactNode {
  const managesOwnSpacing = React.Children.toArray(children).some(
    (child) =>
      React.isValidElement(child) &&
      (child.type === DialogContent || child.type === DialogActions),
  );
  if (managesOwnSpacing) return children;
  return <Box sx={{ px: 3, pb: 2.5, pt: hasTitle ? 0.5 : 2.5 }}>{children}</Box>;
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