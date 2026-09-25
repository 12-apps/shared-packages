import Box from '@mui/material/Box/index.js';
import Card from '@mui/material/Card/index.js';
import CardContent from '@mui/material/CardContent/index.js';
import Popover from '@mui/material/Popover/index.js';
import { styled, type Theme } from '@mui/material/styles/index.js';
import React from 'react';

import { rem } from '../../../tokens/relative';
import { withDefaults } from '../../../utils/withDefaults';

import { HoverCardContent } from './HoverCard.content';
import { useHoverCard } from './HoverCard.hooks';
import { arrowSx, cardSx, getAnchorOrigin, getTransformOrigin, sideOf } from './HoverCard.styles';
import type { CardStyleFlags } from './HoverCard.styles';
import type { HoverCardAnimation, HoverCardPlacement, HoverCardProps } from './HoverCard.types';

const ArrowContainer = styled('div')<{ placement: HoverCardPlacement; offset?: number }>(
  ({ theme, placement }) => ({ ...arrowSx(theme, placement) }),
);

const StyledCard = styled(Card, {
  shouldForwardProp: (prop) =>
    !['customVariant', 'glow', 'pulse', 'animation'].includes(prop as string),
})<CardStyleFlags>(({ theme, ...flags }) => ({ ...cardSx(theme, flags) }));

const StyledPopover = styled(Popover, {
  shouldForwardProp: (prop) => prop !== 'customAnimation',
})<{ customAnimation?: HoverCardAnimation }>(({ customAnimation }) => ({
  // Only the card takes the pointer (its paper sets `pointer-events: auto`).
  // MUI's popover root and its invisible backdrop cover the whole viewport, so
  // while a card was open the pointer was "on the card" wherever it went: the
  // backdrop's mouseover reached the card's onMouseEnter and cancelled the
  // close the trigger's mouseleave had just scheduled. A card left by moving
  // the mouse away stayed open, and the page's next click hit the backdrop
  // instead of its target (FUT-2619). The backdrop was also the only
  // click-away; `useClickAway` in the hooks replaces it.
  pointerEvents: 'none',
  // The popover only positions; StyledCard draws the surface.
  '& .MuiPopover-paper': {
    backgroundColor: 'transparent',
    boxShadow: 'none',
    overflow: 'visible',
    ...(customAnimation === 'scale' && { transformOrigin: 'center' }),
  },
}));

const DEFAULTS = {
  variant: 'default',
  glow: false,
  pulse: false,
  placement: 'bottom',
  showArrow: false,
  animation: 'fade',
  enterDelay: 700,
  exitDelay: 0,
  loading: false,
  touchEnabled: true,
  disabled: false,
} satisfies Partial<HoverCardProps>;

type ResolvedProps = HoverCardProps & Required<Pick<HoverCardProps, keyof typeof DEFAULTS>>;

/** Padding is the variant's own: detailed roomier, minimal tighter. */
const CONTENT_PADDING: Record<string, number> = { detailed: 3, minimal: 1.5 };

/**
 * The card is nudged off the anchor on whichever side it sits — `offset` design
 * px (8 unless the caller says otherwise), through the theme's type scale.
 */
const offsetMargin = (theme: Theme, placement: HoverCardPlacement, offset: number | undefined) => {
  const side = sideOf(placement);
  const key = ({ top: 'mt', bottom: 'mb', left: 'ml', right: 'mr' } as const)[side];
  return { [key]: rem(theme, offset ?? 8) };
};

/**
 * The card's cap: 400 design px unless the caller says otherwise. `sx` has always
 * read a number of 1 or less as a fraction of the parent, and that stays so.
 */
const capOf = (theme: Theme, maxWidth: number | undefined): string => {
  const cap = maxWidth ?? 400;
  return cap <= 1 && cap !== 0 ? `${cap * 100}%` : rem(theme, cap);
};

export const HoverCard = React.forwardRef<HTMLDivElement, HoverCardProps>((props, ref) => {
  const {
    variant, glow, pulse, title, description, avatar, trigger, placement, showArrow,
    animation, enterDelay, exitDelay, maxWidth, loading, loadingComponent, loadingText, touchEnabled,
    offset, disabled, onOpen, onClose, children, dataTestId,
    ...rest
  } = withDefaults(props, DEFAULTS) as ResolvedProps;

  const { anchorEl, isOpen, handleClose, triggerHandlers, cardHandlers, contentRef } = useHoverCard({
    disabled,
    touchEnabled,
    enterDelay,
    exitDelay,
    onOpen,
    onClose,
  });

  const triggerProps = {
    ...triggerHandlers,
    style: { cursor: disabled ? 'default' : 'pointer' },
    'data-testid': dataTestId ? `${dataTestId}-trigger` : 'hover-card-trigger',
  };

  const triggerElement = trigger ? (
    React.cloneElement(trigger, triggerProps)
  ) : (
    <span {...triggerProps} style={{ display: 'inline-block', ...triggerProps.style }}>
      {children}
    </span>
  );

  const padding = CONTENT_PADDING[variant] ?? 2;

  return (
    <>
      {triggerElement}
      <StyledPopover
        ref={ref}
        open={isOpen && !disabled}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={getAnchorOrigin(placement)}
        transformOrigin={getTransformOrigin(placement)}
        {...cardHandlers}
        disableAutoFocus
        disableEnforceFocus
        disableRestoreFocus
        customAnimation={animation}
        slotProps={{ paper: { style: { pointerEvents: 'auto' } } }}
        {...rest}
      >
        <Box ref={contentRef} sx={{ position: 'relative' }}>
          {showArrow && <ArrowContainer placement={placement} offset={offset} />}
          <StyledCard
            customVariant={variant}
            glow={glow}
            pulse={pulse}
            animation={animation}
            data-testid={dataTestId || 'hover-card-content'}
            sx={(theme) => ({ maxWidth: capOf(theme, maxWidth), ...offsetMargin(theme, placement, offset) })}
          >
            <CardContent sx={{ p: padding, '&:last-child': { pb: padding } }}>
              <HoverCardContent
                loadingText={loadingText} variant={variant} title={title}
                description={description}
                avatar={avatar}
                loading={loading}
                loadingComponent={loadingComponent}
                dataTestId={dataTestId}
              >
                {children}
              </HoverCardContent>
            </CardContent>
          </StyledCard>
        </Box>
      </StyledPopover>
    </>
  );
});

HoverCard.displayName = 'HoverCard';
