import ArrowBackIosIcon from '@mui/icons-material/ArrowBackIos';
import ArrowForwardIosIcon from '@mui/icons-material/ArrowForwardIos';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import Box from '@mui/material/Box/index.js';
import IconButton from '@mui/material/IconButton/index.js';
import Typography from '@mui/material/Typography/index.js';
import { alpha, useTheme } from '@mui/material/styles/index.js';
import type { CSSObject, Theme } from '@mui/material/styles/index.js';
import React from 'react';

import { withDefaults } from '../../../utils/withDefaults';

import { accentFor, muiSize } from '../../../tokens/scales';

import type {
  CarouselArrowsProps,
  CarouselIndicatorsProps,
  CarouselItem,
  CarouselThumbnailsProps,
} from './Carousel.types';

type IndicatorPosition = NonNullable<CarouselIndicatorsProps['position']>;
type IndicatorVariant = NonNullable<CarouselIndicatorsProps['variant']>;
type Color = NonNullable<CarouselIndicatorsProps['color']>;

/** Fires `onSelect` for the keys a native button would treat as activation. */
const activateOnKey = (onSelect: () => void) => (e: React.KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    onSelect();
  }
};

const INDICATOR_POSITIONS = (theme: Theme): Record<IndicatorPosition, CSSObject> => ({
  top: { top: theme.spacing(2), left: '50%', transform: 'translateX(-50%)' },
  bottom: { bottom: theme.spacing(2), left: '50%', transform: 'translateX(-50%)' },
  left: {
    left: theme.spacing(2),
    top: '50%',
    transform: 'translateY(-50%)',
    flexDirection: 'column',
  },
  right: {
    right: theme.spacing(2),
    top: '50%',
    transform: 'translateY(-50%)',
    flexDirection: 'column',
  },
});

interface IndicatorProps {
  index: number;
  isActive: boolean;
  color: Color;
  onSelect: () => void;
}

/** Attributes every indicator variant carries, whatever it draws. */
const indicatorAttrs = (index: number, isActive: boolean) => ({
  'aria-label': `Go to slide ${index + 1}`,
  'data-testid': `carousel-indicator-${index}`,
  'data-active': isActive,
});

const LineIndicator: React.FC<IndicatorProps> = ({ index, isActive, color, onSelect }) => {
  const theme = useTheme();

  return (
    <Box
      role="button"
      tabIndex={0}
      {...indicatorAttrs(index, isActive)}
      sx={{
        width: isActive ? 30 : 20,
        height: 3,
        backgroundColor: isActive
          ? accentFor(theme, color).main
          : alpha(accentFor(theme, color).main, 0.3),
        borderRadius: 1.5,
        transition: theme.transitions.create(['width', 'background-color']),
        cursor: 'pointer',
      }}
      onClick={onSelect}
      onKeyDown={activateOnKey(onSelect)}
    />
  );
};

const NumberIndicator: React.FC<IndicatorProps> = ({ index, isActive, color, onSelect }) => {
  const theme = useTheme();

  return (
    <Box
      role="button"
      tabIndex={0}
      {...indicatorAttrs(index, isActive)}
      sx={{
        width: 24,
        height: 24,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '50%',
        backgroundColor: isActive ? accentFor(theme, color).main : 'transparent',
        color: isActive ? accentFor(theme, color).contrastText : accentFor(theme, color).main,
        border: `1px solid ${accentFor(theme, color).main}`,
        fontSize: '0.75rem',
        fontWeight: isActive ? 'bold' : 'normal',
        cursor: 'pointer',
        transition: theme.transitions.create(['all']),
      }}
      onClick={onSelect}
      onKeyDown={activateOnKey(onSelect)}
    >
      {index + 1}
    </Box>
  );
};

const DotIndicator: React.FC<IndicatorProps> = ({ index, isActive, color, onSelect }) => {
  const theme = useTheme();

  return (
    <IconButton
      size="small"
      {...indicatorAttrs(index, isActive)}
      onClick={onSelect}
      sx={{
        p: 0.5,
        color: isActive ? accentFor(theme, color).main : alpha(accentFor(theme, color).main, 0.3),
        transform: isActive ? 'scale(1.2)' : 'scale(1)',
        transition: theme.transitions.create(['transform', 'color']),
      }}
    >
      <FiberManualRecordIcon fontSize="small" />
    </IconButton>
  );
};

const INDICATORS: Record<IndicatorVariant, React.FC<IndicatorProps>> = {
  lines: LineIndicator,
  numbers: NumberIndicator,
  dots: DotIndicator,
};

const INDICATORS_DEFAULTS = {
  position: 'bottom',
  color: 'primary',
  variant: 'dots',
} satisfies Partial<CarouselIndicatorsProps>;

export const CarouselIndicators: React.FC<CarouselIndicatorsProps> = (props) => {
  const { count, activeIndex, onSelect, position, color, variant, className, style } = withDefaults(
    props,
    INDICATORS_DEFAULTS,
  ) as CarouselIndicatorsProps & Required<Pick<CarouselIndicatorsProps, keyof typeof INDICATORS_DEFAULTS>>;

  const theme = useTheme();
  const Indicator = INDICATORS[variant] ?? DotIndicator;

  return (
    <Box
      className={className}
      data-testid="carousel-indicators"
      sx={{
        position: 'absolute',
        display: 'flex',
        gap: 1,
        zIndex: 2,
        ...(INDICATOR_POSITIONS(theme)[position] ?? INDICATOR_POSITIONS(theme).bottom),
        ...style,
      }}
    >
      {Array.from({ length: count }).map((_, index) => (
        <Indicator
          key={index}
          index={index}
          isActive={index === activeIndex}
          color={color}
          onSelect={() => onSelect(index)}
        />
      ))}
    </Box>
  );
};

const ARROWS_DEFAULTS = {
  position: 'overlay',
  disabled: false,
  disablePrev: false,
  disableNext: false,
  color: 'primary',
  size: 'md',
} satisfies Partial<CarouselArrowsProps>;

/**
 * All three positions place the arrow the same way; only `overlay` fades it back
 * until hovered, and only `outside` sits it clear of the frame.
 */
const arrowSx = (theme: Theme, color: Color, isOverlay: boolean): CSSObject => ({
  position: 'absolute',
  top: '50%',
  transform: 'translateY(-50%)',
  zIndex: 3,
  backgroundColor: alpha(theme.palette.background.paper, 0.8),
  color: accentFor(theme, color).main,
  '&:disabled': { opacity: 0.3 },
  ...(isOverlay
    ? {
        opacity: 0.7,
        '&:hover': { backgroundColor: theme.palette.background.paper, opacity: 1 },
      }
    : { '&:hover': { backgroundColor: theme.palette.background.paper } }),
});

export const CarouselArrows: React.FC<CarouselArrowsProps> = (props) => {
  const {
    copy, onPrev, onNext, position, disabled, disablePrev, disableNext, color, size, className,
    style,
  } = withDefaults(props, ARROWS_DEFAULTS) as CarouselArrowsProps &
    Required<Pick<CarouselArrowsProps, keyof typeof ARROWS_DEFAULTS>>;

  const theme = useTheme();
  const sx = arrowSx(theme, color, position === 'overlay');
  const offset = position === 'outside' ? -40 : 8;

  return (
    <Box data-testid="carousel-navigation">
      <IconButton
        onClick={onPrev}
        disabled={disabled || disablePrev}
        size={muiSize(size)}
        className={className}
        aria-label={copy.previous}
        data-testid="carousel-prev-button"
        sx={{ ...sx, left: offset, ...style }}
      >
        <ArrowBackIosIcon />
      </IconButton>

      <IconButton
        onClick={onNext}
        disabled={disabled || disableNext}
        aria-label={copy.next}
        size={muiSize(size)}
        className={className}
        data-testid="carousel-next-button"
        sx={{ ...sx, right: offset, ...style }}
      >
        <ArrowForwardIosIcon />
      </IconButton>
    </Box>
  );
};

const THUMBNAIL_SIZES = { xs: 40, sm: 60, md: 80, lg: 100, xl: 120 } as const;
const DEFAULT_THUMBNAIL_SIZE = 60;

const Thumbnail: React.FC<{
  item: CarouselItem;
  index: number;
  isActive: boolean;
  side: number;
  onSelect: () => void;
}> = ({ item, index, isActive, side, onSelect }) => {
  const theme = useTheme();

  return (
    <Box
      onClick={onSelect}
      data-testid={`carousel-thumbnail-${index}`}
      data-active={isActive}
      sx={{
        width: side,
        height: side,
        border: `2px solid ${isActive ? theme.palette.primary.main : 'transparent'}`,
        borderRadius: 1,
        overflow: 'hidden',
        cursor: 'pointer',
        opacity: isActive ? 1 : 0.6,
        transition: theme.transitions.create(['opacity', 'border-color']),
        '&:hover': { opacity: 1 },
      }}
    >
      {item.image ? (
        <Box
          component="img"
          src={item.image}
          alt={item.alt || item.title}
          sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        // No image to show, so the slide's number stands in for it.
        <Box
          sx={{
            width: '100%',
            height: '100%',
            backgroundColor: theme.palette.grey[300],
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Typography variant="caption">{index + 1}</Typography>
        </Box>
      )}
    </Box>
  );
};

export const CarouselThumbnails: React.FC<CarouselThumbnailsProps> = ({
  items,
  activeIndex,
  onSelect,
  size = 'sm',
  className,
  style,
}) => {
  const theme = useTheme();
  const side = THUMBNAIL_SIZES[size as keyof typeof THUMBNAIL_SIZES] ?? DEFAULT_THUMBNAIL_SIZE;

  return (
    <Box
      className={className}
      data-testid="carousel-thumbnails"
      sx={{
        position: 'absolute',
        // Hung below the frame, clear of its own height plus a gap.
        bottom: -side - 16,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        gap: 1,
        p: 1,
        backgroundColor: alpha(theme.palette.background.paper, 0.9),
        borderRadius: 1,
        ...style,
      }}
    >
      {items.map((item, index) => (
        <Thumbnail
          key={item.id}
          item={item}
          index={index}
          isActive={index === activeIndex}
          side={side}
          onSelect={() => onSelect(index)}
        />
      ))}
    </Box>
  );
};
