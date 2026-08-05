import CloseIcon from '@mui/icons-material/Close';
import { alpha, Backdrop, Box, Divider, Fade, IconButton, Typography, useTheme } from '@mui/material';
import type { Theme } from '@mui/material';
import React from 'react';

import { withDefaults } from '../../../utils/withDefaults';

import { shimmerAnimation } from './Sheet.animations';
import type {
  SheetContentProps,
  SheetFooterProps,
  SheetHeaderProps,
  SheetOverlayProps,
} from './Sheet.types';

/**
 * The grab handle's own styling. A draggable handle is deliberately larger and
 * tinted, so the affordance reads as draggable before the user tries it; a
 * decorative one stays a neutral bar.
 */
const handleSx = (theme: Theme, isDraggable: boolean) => ({
  width: isDraggable ? 48 : 32,
  height: isDraggable ? 6 : 4,
  backgroundColor: alpha(theme.palette.text.primary, 0.3),
  borderRadius: 3,
  transition: theme.transitions.create(['all'], {
    duration: theme.transitions.duration.short,
    easing: theme.transitions.easing.easeInOut,
  }),
  position: 'relative',
  overflow: 'hidden',
  '&::after': {
    content: '""',
    position: 'absolute',
    top: 0,
    left: '-100%',
    width: '100%',
    height: '100%',
    background: `linear-gradient(
      90deg,
      transparent,
      ${alpha(theme.palette.common.white, 0.3)},
      transparent
    )`,
    animation: isDraggable ? `${shimmerAnimation} 2s infinite` : 'none',
  },
  ...(isDraggable && {
    backgroundColor: alpha(theme.palette.primary.main, 0.4),
    boxShadow: `0 2px 4px ${alpha(theme.palette.primary.main, 0.2)}`,
    '&:hover': {
      backgroundColor: theme.palette.primary.main,
      transform: 'scaleX(1.15) scaleY(1.2)',
      boxShadow: `0 3px 6px ${alpha(theme.palette.primary.main, 0.3)}`,
    },
  }),
});

const SheetHandle: React.FC<{ isDraggable: boolean }> = ({ isDraggable }) => {
  const theme = useTheme();

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'center',
        mb: 1,
        // The handle is decoration on a draggable header: the drag listeners sit
        // on the header itself, so letting the bar swallow the press would open
        // a dead zone in the middle of the grab target.
        pointerEvents: isDraggable ? 'none' : 'auto',
      }}
    >
      <Box sx={handleSx(theme, isDraggable)} />
    </Box>
  );
};

const HEADER_DEFAULTS: Partial<SheetHeaderProps> = {
  isDraggable: false,
  dataTestId: 'sheet-header',
};

export const SheetHeader: React.FC<SheetHeaderProps> = (props) => {
  const {
    title,
    description,
    showCloseButton,
    onClose,
    showHandle,
    isDraggable,
    onDragStart,
    className,
    style,
    children,
    dataTestId,
  } = withDefaults(props, HEADER_DEFAULTS);

  return (
    <Box
      className={className}
      data-testid={dataTestId}
      sx={{
        p: 2,
        pb: showHandle ? 1 : 2,
        cursor: isDraggable ? 'grab' : 'auto',
        '&:active': isDraggable ? { cursor: 'grabbing' } : {},
        ...style,
      }}
      onMouseDown={isDraggable ? onDragStart : undefined}
      onTouchStart={isDraggable ? onDragStart : undefined}
    >
      {showHandle && <SheetHandle isDraggable={Boolean(isDraggable)} />}

      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <Box sx={{ flex: 1 }}>
          {title && (
            <Typography variant="h6" sx={{ fontWeight: 600 }} data-testid={`${dataTestId}-title`}>
              {title}
            </Typography>
          )}
          {description && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {description}
            </Typography>
          )}
          {children}
        </Box>

        {showCloseButton && (
          <IconButton
            onClick={onClose}
            size="small"
            sx={{ ml: 1, mt: -0.5 }}
            data-testid={`${dataTestId}-close-button`}
          >
            <CloseIcon data-testid={`${dataTestId}-close-icon`} />
          </IconButton>
        )}
      </Box>
    </Box>
  );
};

const CONTENT_DEFAULTS: Partial<SheetContentProps> = {
  padded: true,
  dataTestId: 'sheet-content',
};

export const SheetContent: React.FC<SheetContentProps> = (props) => {
  const { children, className, style, padded, dataTestId } = withDefaults(props, CONTENT_DEFAULTS);

  return (
    <Box
      className={className}
      data-testid={dataTestId}
      sx={{ flex: 1, overflow: 'auto', p: padded ? 2 : 0, ...style }}
    >
      {children}
    </Box>
  );
};

const FOOTER_DEFAULTS: Partial<SheetFooterProps> = {
  sticky: false,
  divider: false,
  dataTestId: 'sheet-footer',
};

export const SheetFooter: React.FC<SheetFooterProps> = (props) => {
  const { children, className, style, sticky, divider, dataTestId } = withDefaults(
    props,
    FOOTER_DEFAULTS,
  );

  return (
    <>
      {divider && <Divider />}
      <Box
        className={className}
        data-testid={dataTestId}
        sx={{
          p: 2,
          position: sticky ? 'sticky' : 'relative',
          bottom: sticky ? 0 : 'auto',
          backgroundColor: 'background.paper',
          borderTop: sticky ? '1px solid' : 'none',
          borderColor: 'divider',
          ...style,
        }}
      >
        {children}
      </Box>
    </>
  );
};

const OVERLAY_DEFAULTS: Partial<SheetOverlayProps> = {
  open: false,
  blur: false,
};

export const SheetOverlay: React.FC<SheetOverlayProps> = (props) => {
  const { open, onClick, className, style, blur } = withDefaults(props, OVERLAY_DEFAULTS);
  const theme = useTheme();

  return (
    <Fade in={open} timeout={300}>
      <Backdrop
        open={Boolean(open)}
        onClick={onClick}
        className={className}
        sx={{
          // One below the drawer: this backdrop replaces MUI's own (the drawer
          // is given a no-op BackdropComponent) and must sit under the panel.
          zIndex: theme.zIndex.drawer - 1,
          backgroundColor: alpha(theme.palette.common.black, blur ? 0.6 : 0.5),
          backdropFilter: blur ? 'blur(8px) saturate(180%)' : 'none',
          WebkitBackdropFilter: blur ? 'blur(8px) saturate(180%)' : 'none',
          ...style,
        }}
      />
    </Fade>
  );
};
