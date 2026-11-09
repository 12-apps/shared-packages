import Box from '@mui/material/Box/index.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import React, { useState } from 'react';

import { Carousel } from './Carousel';
import type { CarouselItem } from './Carousel.types';
import { PT_BR_CAROUSEL_COPY } from '../../../pt-BR';

/**
 * The photo-gallery use of the carousel: swipe on a phone, arrows on a
 * computer, an "n of m" chip, pill dots and a start index. Every state is here
 * so the swipe, the keys and the tap can be driven in the browser.
 */
const meta: Meta<typeof Carousel> = {
  args: { copy: PT_BR_CAROUSEL_COPY },
  title: 'Media/Carousel/Gallery',
  component: Carousel,
  parameters: { layout: 'padded' },
  tags: ['autodocs', 'component:Carousel'],
};

export default meta;
type Story = StoryObj<typeof Carousel>;

const TONES = ['#d98a5f', '#b8a07a', '#8fa98c', '#7f9bb5', '#a68bb0'];

const svg = (fill: string): string =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="${fill}"/></svg>`,
  )}`;

const photo = (index: number): string => svg(TONES[index % TONES.length] ?? TONES[0]);

/** The two extremes the chrome must hold on: a near-white photo and a near-black one. */
const tonePhotos = (fill: string): CarouselItem[] =>
  photos(5).map((item) => ({ ...item, image: svg(fill) }));

const photos = (count: number): CarouselItem[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `photo-${index + 1}`,
    content: null,
    image: photo(index),
    alt: `Foto ${index + 1}`,
    title: index === 0 ? 'Lado · contracapa' : undefined,
  }));

const gallery = {
  items: photos(5),
  height: 320,
  animation: 'slide' as const,
  autoPlay: false,
  loop: true,
  showCounter: true,
  arrowVariant: 'surface' as const,
  indicatorVariant: 'pills' as const,
  variant: 'minimal' as const,
};

const Frame: React.FC<{ width: number; children: React.ReactNode }> = ({ width, children }) => (
  <Box sx={{ width, maxWidth: '100%' }}>{children}</Box>
);

/** Phone width: drag the photo sideways; the arrows give way to the swipe. */
export const PhoneSwipe: Story = {
  render: (args) => (
    <Frame width={390}>
      <Carousel {...args} hideArrowsOnTouch />
    </Frame>
  ),
  args: gallery,
};

/** Computer width: round arrows at the sides, Left and Right keys when focused. */
export const DesktopArrows: Story = {
  render: (args) => (
    <Frame width={720}>
      <Carousel {...args} />
    </Frame>
  ),
  args: { ...gallery, height: 400 },
};

/** The sheet opens on the contracapa, which need not be the first photo. */
export const StartOnThirdItem: Story = {
  render: (args) => (
    <Frame width={390}>
      <Carousel {...args} />
    </Frame>
  ),
  args: { ...gallery, startIndex: 2 },
};

/** One photo has nowhere to go: no arrows, dots or counter, and no swipe. */
export const SingleItem: Story = {
  render: (args) => (
    <Frame width={390}>
      <Carousel {...args} />
    </Frame>
  ),
  args: { ...gallery, items: photos(1) },
};

export const CounterHidden: Story = {
  render: (args) => (
    <Frame width={390}>
      <Carousel {...args} />
    </Frame>
  ),
  args: { ...gallery, showCounter: false },
};

export const CounterBottom: Story = {
  render: (args) => (
    <Frame width={390}>
      <Carousel {...args} />
    </Frame>
  ),
  args: { ...gallery, counterPosition: 'bottom-end' },
};

/** A tap reports which photo it landed on; a swipe never does. */
export const TapReportsTheItem: Story = {
  render: (args) => {
    const [tapped, setTapped] = useState<string>('nenhuma');
    return (
      <Frame width={390}>
        <Carousel {...args} onClick={(item, index) => setTapped(`${item.id} (${index})`)} />
        <Box data-testid="tapped" sx={{ mt: 1 }}>
          Tocada: {tapped}
        </Box>
      </Frame>
    );
  },
  args: gallery,
};

/** The approved storefront frame: the pill dots sit under the photo, not on it. */
export const DotsBelow: Story = {
  render: (args) => (
    <Frame width={390}>
      <Carousel {...args} />
    </Frame>
  ),
  args: { ...gallery, indicatorPosition: 'below', hideArrowsOnTouch: true },
};

export const DotsBelowDesktop: Story = {
  render: (args) => (
    <Frame width={720}>
      <Carousel {...args} />
    </Frame>
  ),
  args: { ...gallery, height: 400, indicatorPosition: 'below' },
};

/** The narrowest phone: the row stays under the photo and the pills stay tappable. */
export const DotsBelow320: Story = {
  render: (args) => (
    <Frame width={320}>
      <Carousel {...args} />
    </Frame>
  ),
  args: { ...gallery, indicatorPosition: 'below', hideArrowsOnTouch: true },
};

/** A near-white photo: the arrows, pills and chip are judged on it. */
export const LightPhoto: Story = {
  render: (args) => (
    <Frame width={390}>
      <Carousel {...args} />
    </Frame>
  ),
  args: { ...gallery, items: tonePhotos('#f4efe6'), indicatorPosition: 'below' },
};

/** A near-black photo, the other extreme. */
export const DarkPhoto: Story = {
  render: (args) => (
    <Frame width={390}>
      <Carousel {...args} />
    </Frame>
  ),
  args: { ...gallery, items: tonePhotos('#14110f'), indicatorPosition: 'below' },
};

/** The pills over the photo (on their scrim chip), on the near-white photo. */
export const PillsOnPhoto: Story = {
  render: (args) => (
    <Frame width={390}>
      <Carousel {...args} />
    </Frame>
  ),
  args: { ...gallery, items: tonePhotos('#f4efe6'), indicatorPosition: 'bottom' },
};
