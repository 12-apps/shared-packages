import { Backdrop, Box, Modal as MuiModal, useTheme } from '@mui/material';
import React from 'react';

import { withDefaults } from '../../../utils/withDefaults';

import { backdropSx, panelSx } from './Modal.styles';
import { transitionFor } from './Modal.transitions';
import type { ModalContentProps, ModalProps } from './Modal.types';

const DEFAULTS = {
  variant: 'center',
  size: 'md',
  backdrop: true,
  persistent: false,
  glass: false,
  gradient: false,
  glow: false,
  pulse: false,
  borderRadius: 'lg',
} satisfies Partial<ModalProps>;

type ResolvedProps = ModalProps & Required<Pick<ModalProps, keyof typeof DEFAULTS>>;

export const Modal: React.FC<ModalProps> = (props) => {
  const {
    children, variant, size, backdrop, persistent, glass, gradient, glow, pulse,
    borderRadius, onClose, open, dataTestId,
    ...rest
  } = withDefaults(props, DEFAULTS) as ResolvedProps;

  const theme = useTheme();
  const isGlass = glass || variant === 'glass';

  /** A persistent modal ignores the two dismissals it did not ask for. */
  const handleClose = (_event: object, reason: 'backdropClick' | 'escapeKeyDown') => {
    if (persistent && (reason === 'backdropClick' || reason === 'escapeKeyDown')) {
      return;
    }
    onClose?.();
  };

  const TransitionComponent = transitionFor(variant);

  return (
    <MuiModal
      open={open}
      onClose={handleClose}
      closeAfterTransition
      BackdropComponent={backdrop ? Backdrop : undefined}
      BackdropProps={{
        timeout: 500,
        sx: backdropSx(theme, isGlass),
        // @ts-expect-error - data-testid is not part of BackdropProps type but is valid HTML
        'data-testid': dataTestId ? `${dataTestId}-backdrop` : 'modal-backdrop',
      }}
      {...rest}
    >
      <TransitionComponent in={open} timeout={500}>
        <Box
          sx={panelSx(theme, { variant, size, borderRadius, glass, gradient, glow, pulse })}
          data-testid={dataTestId || 'modal'}
        >
          {children}
        </Box>
      </TransitionComponent>
    </MuiModal>
  );
};

export const ModalContent: React.FC<ModalContentProps> = ({ children, padding = 3, dataTestId }) => (
  <Box sx={{ p: padding }} data-testid={dataTestId || 'modal-content'}>
    {children}
  </Box>
);
