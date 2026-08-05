import { Box, Paper, Typography, useTheme } from '@mui/material';
import React from 'react';

import type { CarouselItem, CarouselProps } from './Carousel.types';

export interface CarouselSlideProps {
  item: CarouselItem;
  index: number;
  isActive: boolean;
  variant: NonNullable<CarouselProps['variant']>;
  clickable: boolean;
  onSelect: (item: CarouselItem, index: number) => void;
}

/**
 * A slide's caption. Over an image it is white with a shadow so it stays legible
 * against whatever the photograph happens to be; on a bare surface it uses the
 * ordinary text colours.
 */
const SlideCaption: React.FC<Pick<CarouselItem, 'title' | 'description' | 'content' | 'image'>> = ({
  title,
  description,
  content,
  image,
}) => (
  <Box sx={{ position: 'relative', zIndex: 1, textAlign: 'center', p: 3 }}>
    {title && (
      <Typography
        variant="h5"
        sx={{
          color: image ? 'white' : 'text.primary',
          textShadow: image ? '0 2px 4px rgba(0,0,0,0.5)' : 'none',
          mb: 1,
        }}
      >
        {title}
      </Typography>
    )}

    {description && (
      <Typography
        variant="body1"
        sx={{
          color: image ? 'white' : 'text.secondary',
          textShadow: image ? '0 1px 2px rgba(0,0,0,0.5)' : 'none',
        }}
      >
        {description}
      </Typography>
    )}

    {content}
  </Box>
);

export const CarouselSlide: React.FC<CarouselSlideProps> = ({
  item,
  index,
  isActive,
  variant,
  clickable,
  onSelect,
}) => {
  const theme = useTheme();

  const content = (
    <Box
      sx={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        cursor: clickable ? 'pointer' : 'default',
        position: 'relative',
      }}
      onClick={() => onSelect(item, index)}
    >
      {item.image && (
        <Box
          component="img"
          src={item.image}
          alt={item.alt || item.title}
          sx={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            position: 'absolute',
            top: 0,
            left: 0,
          }}
        />
      )}

      <SlideCaption
        title={item.title}
        description={item.description}
        content={item.content}
        image={item.image}
      />
    </Box>
  );

  // The cards variant gives each slide its own raised surface, and lifts the
  // active one further so the stack reads as a deck rather than a strip.
  if (variant === 'cards') {
    return (
      <Paper
        elevation={isActive ? 8 : 2}
        sx={{
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          transform: isActive ? 'scale(1)' : 'scale(0.9)',
          transition: theme.transitions.create(['transform', 'box-shadow']),
        }}
      >
        {content}
      </Paper>
    );
  }

  return content;
};

export interface CarouselTrackProps {
  items: CarouselItem[];
  activeIndex: number;
  variant: NonNullable<CarouselProps['variant']>;
  animation: NonNullable<CarouselProps['animation']>;
  transition: React.ElementType;
  clickable: boolean;
  onSelect: (item: CarouselItem, index: number) => void;
}

/**
 * The slides themselves. Every slide stays mounted and absolutely positioned so
 * the transition has both the outgoing and incoming one to work with; `display`
 * is what actually hides the rest.
 */
export const CarouselTrack: React.FC<CarouselTrackProps> = ({
  items,
  activeIndex,
  variant,
  animation,
  transition: Transition,
  clickable,
  onSelect,
}) => (
  <Box
    data-testid="carousel-track"
    sx={{
      width: '100%',
      height: '100%',
      position: 'relative',
      display: 'flex',
      alignItems: 'center',
    }}
  >
    {items.map((item, index) => (
      <Transition
        key={item.id}
        in={index === activeIndex}
        timeout={600}
        {...(animation === 'flip' && { direction: 'left' as const })}
      >
        <Box
          data-testid={`carousel-slide-${index}`}
          data-active={index === activeIndex}
          sx={{
            position: 'absolute',
            width: '100%',
            height: '100%',
            display: index === activeIndex ? 'block' : 'none',
          }}
        >
          <CarouselSlide
            item={item}
            index={index}
            isActive={index === activeIndex}
            variant={variant}
            clickable={clickable}
            onSelect={onSelect}
          />
        </Box>
      </Transition>
    ))}
  </Box>
);
