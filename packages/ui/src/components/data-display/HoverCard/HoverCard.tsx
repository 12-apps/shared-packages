import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Popover from '@mui/material/Popover';
import { styled } from '@mui/material/styles';
import React from 'react';

import { withDefaults } from '../../../utils/withDefaults';

import { HoverCardContent } from './HoverCard.content';
import { useHoverCard } from './HoverCard.hooks';
import { arrowSx, cardSx, getAnchorOrigin, getTransformOrigin, sideOf } from './HoverCard.styles';
import type { CardStyleFlags } from './HoverCard.styles';
import type { HoverCardAnimation, HoverCardPlacement, HoverCardProps } from './HoverCard.types';

const ArrowContainer = styled('div')<{ placement: HoverCardPlacement; offset: number }>(
  ({ theme, placement }) => ({ ...arrowSx(theme, placement) }),
);

const StyledCard = styled(Card, {
  shouldForwardProp: (prop) =>
    !['customVariant', 'glow', 'pulse', 'animation'].includes(prop as string),
})<CardStyleFlags>(({ theme, ...flags }) => ({ ...cardSx(theme, flags) }));

const StyledPopover = styled(Popover, {
  shouldForwardProp: (prop) => prop !== 'customAnimation',
})<{ customAnimation?: HoverCardAnimation }>(({ customAnimation }) => ({
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
  maxWidth: 400,
  loading: false,
  touchEnabled: true,
  offset: 8,
  disabled: false,
} satisfies Partial<HoverCardProps>;

type ResolvedProps = HoverCardProps & Required<Pick<HoverCardProps, keyof typeof DEFAULTS>>;

/** Padding is the variant's own: detailed roomier, minimal tighter. */
const CONTENT_PADDING: Record<string, number> = { detailed: 3, minimal: 1.5 };

/** The card is nudged off the anchor on whichever side it sits. */
const offsetMargin = (placement: HoverCardPlacement, offset: number) => {
  const side = sideOf(placement);
  const key = ({ top: 'mt', bottom: 'mb', left: 'ml', right: 'mr' } as const)[side];
  return { [key]: `${offset}px` };
};

export const HoverCard = React.forwardRef<HTMLDivElement, HoverCardProps>((props, ref) => {
  const {
    variant, glow, pulse, title, description, avatar, trigger, placement, showArrow,
    animation, enterDelay, exitDelay, maxWidth, loading, loadingComponent, loadingText, touchEnabled,
    offset, disabled, onOpen, onClose, children, dataTestId,
    ...rest
  } = withDefaults(props, DEFAULTS) as ResolvedProps;

  const { anchorEl, isOpen, handleClose, triggerHandlers, cardHandlers } = useHoverCard({
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
        <Box sx={{ position: 'relative' }}>
          {showArrow && <ArrowContainer placement={placement} offset={offset} />}
          <StyledCard
            customVariant={variant}
            glow={glow}
            pulse={pulse}
            animation={animation}
            data-testid={dataTestId || 'hover-card-content'}
            sx={{ maxWidth, ...offsetMargin(placement, offset) }}
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
