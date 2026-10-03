import Drawer from '@mui/material/Drawer/index.js';
import SwipeableDrawer from '@mui/material/SwipeableDrawer/index.js';
import { useTheme } from '@mui/material/styles/index.js';
import type { BackdropProps } from '@mui/material/Backdrop/index.js';
import React from 'react';

import { withDefaults } from '../../../utils/withDefaults';

import {
  DEFAULT_DRAG_RESISTANCE,
  DEFAULT_VELOCITY_THRESHOLD,
  SPRING_CONFIG,
} from './Sheet.animations';
import { SheetBody } from './Sheet.body';
import { useSheetDrag, useSheetOpen } from './Sheet.hooks';
import { SheetOverlay } from './Sheet.parts';
import { panelSx } from './Sheet.styles';
import type { SheetProps } from './Sheet.types';

export { SheetContent, SheetFooter, SheetHeader, SheetOverlay } from './Sheet.parts';

const DEFAULTS = {
  open: false,
  position: 'bottom',
  variant: 'default',
  size: 'md',
  color: 'primary',
  glow: false,
  pulse: false,
  glass: false,
  gradient: false,
  loading: false,
  disabled: false,
  showOverlay: true,
  closeOnOverlayClick: true,
  closeOnEscape: true,
  showCloseButton: true,
  showHandle: true,
  swipeable: true,
  snapPoints: [0.25, 0.5, 0.75, 1],
  defaultSnapPoint: 0.5,
  minSnapPoint: 0,
  maxSnapPoint: 1,
  velocityThreshold: DEFAULT_VELOCITY_THRESHOLD,
  dragResistance: DEFAULT_DRAG_RESISTANCE,
  animationConfig: SPRING_CONFIG,
  persistent: false,
  fullHeight: false,
  rounded: true,
  elevation: 16,
  dataTestId: 'sheet',
} satisfies Partial<SheetProps>;

/**
 * The props with every defaulted key now guaranteed present. Without this the
 * component would need a `?? fallback` at each use site, and each of those is a
 * branch the complexity gate counts.
 */
type ResolvedSheetProps = SheetProps & Required<Pick<SheetProps, keyof typeof DEFAULTS>>;

/**
 * The drawer's own backdrop, made invisible: it only CATCHES the tap.
 *
 * The visible veil is {@link SheetOverlay}, which knows about the `glass`
 * blur. But the drawer's modal root covers the whole viewport above that veil,
 * so with no backdrop at all a tap on the veil landed on the bare root, which
 * handles nothing — and no sheet ever closed on an outside tap. This one sits
 * under the panel, paints nothing, and hands the tap to the drawer's
 * `onClose('backdropClick')`, which the sheet routes through its own
 * `closeOnOverlayClick` / `persistent` rules.
 *
 * Defined at module scope: a component built inside a render is a new type on
 * every pass, which remounts the subtree it belongs to.
 */
const ClickCatcher = React.forwardRef<HTMLDivElement, BackdropProps & { 'data-testid'?: string }>(
  ({ onClick, 'data-testid': testId }, ref) => (
    <div
      ref={ref}
      aria-hidden
      onClick={onClick}
      data-testid={testId}
      style={{ position: 'fixed', inset: 0, backgroundColor: 'transparent' }}
    />
  ),
) as React.ComponentType<BackdropProps>;
ClickCatcher.displayName = 'SheetClickCatcher';

/**
 * Which way the sheet is anchored. Four flags rather than four repeated
 * comparisons, and the only thing the hooks and styles need to know about
 * `position` and `variant`.
 */
const orientationOf = ({ position, variant }: ResolvedSheetProps) => {
  const isBottomSheet = position === 'bottom';
  const isTopSheet = position === 'top';

  return {
    isBottomSheet,
    isTopSheet,
    isVerticalSheet: isBottomSheet || isTopSheet,
    isDraggableVariant: variant === 'draggable',
  };
};

export const Sheet: React.FC<SheetProps> = (props) => {
  const resolved = withDefaults(props, DEFAULTS) as ResolvedSheetProps;
  const { position, variant, showOverlay, swipeable, className, dataTestId } = resolved;

  const theme = useTheme();
  const orientation = orientationOf(resolved);

  // Support both the dataTestId prop and a plain data-testid attribute.
  const testId = (resolved as { 'data-testid'?: string })['data-testid'] || dataTestId;

  const { sheetRef, currentHeight, isDragging, isAnimating, handleDragStart, resetToDefaultSnapPoint } =
    useSheetDrag({ ...resolved, ...orientation });

  const { isOpen, handleClose, handleOverlayClick, handleSwipeOpen } = useSheetOpen({
    ...resolved,
    ...orientation,
    resetToDefaultSnapPoint,
  });

  const drawerProps = {
    anchor: position,
    open: isOpen,
    className,
    ...(resolved.animated === false ? { transitionDuration: 0 } : {}),
    // A tap outside obeys `closeOnOverlayClick`. A swipe-to-dismiss (no
    // reason: SwipeableDrawer calls `onClose()` bare) closes. Escape is the
    // hook's own listener alone, which honours `closeOnEscape` — the modal's
    // is switched off below so the key never closes twice or past the flag.
    onClose: (_event?: object, reason?: 'backdropClick' | 'escapeKeyDown') =>
      reason === 'backdropClick' ? handleOverlayClick() : handleClose(),
    PaperProps: {
      ref: sheetRef,
      sx: panelSx({ ...resolved, ...orientation, theme, currentHeight, isDragging, isAnimating }),
    },
    ModalProps: {
      keepMounted: true,
      disableEscapeKeyDown: true,
      BackdropComponent: ClickCatcher,
      BackdropProps: { 'data-testid': testId ? `${testId}-click-catcher` : undefined } as Partial<BackdropProps>,
    },
  };

  const body = (
    <SheetBody
      {...resolved}
      {...orientation}
      testId={testId}
      isDragging={isDragging}
      onClose={handleClose}
      onDragStart={handleDragStart}
    />
  );

  // The draggable variant drives the panel's height itself; MUI's swipe handling
  // would be a second thing moving it.
  const isSwipeable = swipeable && !orientation.isDraggableVariant;

  return (
    <>
      {showOverlay && isOpen && (
        <SheetOverlay open={isOpen} onClick={handleOverlayClick} blur={variant === 'glass'} />
      )}

      {isSwipeable ? (
        <SwipeableDrawer
          {...drawerProps}
          onOpen={handleSwipeOpen}
          disableSwipeToOpen={false}
          swipeAreaWidth={20}
        >
          {body}
        </SwipeableDrawer>
      ) : (
        <Drawer {...drawerProps}>{body}</Drawer>
      )}
    </>
  );
};
