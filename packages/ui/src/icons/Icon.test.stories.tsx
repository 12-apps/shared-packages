import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { expect, within } from 'storybook/test';

import { Icon } from './Icon';
import { ICON_PATHS } from './paths.generated';
import { Box } from '../components/layout/Box/Box';

const meta: Meta<typeof Icon> = {
  title: 'Utility/Icon/Tests',
  component: Icon,
  parameters: { layout: 'centered', chromatic: { disableSnapshot: false } },
  tags: ['autodocs', 'test', 'component:Icon'],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const DrawsTheGeneratedPath: Story = {
  name: '✏️ Draws The Generated Path',
  args: { name: 'Close', dataTestId: 'close' },
  play: async ({ canvasElement }) => {
    const svg = within(canvasElement).getByTestId('close');
    await expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    await expect(svg.querySelector('path')?.getAttribute('d')).toBe(ICON_PATHS.Close[0]);
    const box = svg.getBoundingClientRect();
    await expect(Math.round(box.width)).toBe(24);
    await expect(Math.round(box.height)).toBe(24);
  },
};

export const SizesOnTheScale: Story = {
  name: '📐 Sizes On The Scale',
  render: () => (
    <Box direction="row" gap={1} align="end">
      <Icon name="Search" size="xs" dataTestId="xs" />
      <Icon name="Search" size="xl" dataTestId="xl" />
      <Icon name="Search" size={30} dataTestId="n" />
    </Box>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(Math.round(canvas.getByTestId('xs').getBoundingClientRect().width)).toBe(16);
    await expect(Math.round(canvas.getByTestId('xl').getBoundingClientRect().width)).toBe(40);
    await expect(Math.round(canvas.getByTestId('n').getBoundingClientRect().width)).toBe(30);
  },
};

export const PaletteFill: Story = {
  name: '🎨 Palette Fill',
  render: () => (
    <Box direction="row" gap={1}>
      <Icon name="Info" color="danger" dataTestId="danger" />
      <Icon name="Info" color="#123456" dataTestId="literal" />
    </Box>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const fill = (id: string) => {
      const svg = canvas.getByTestId(id);
      // The web paints through `color` + `fill: currentColor`; native sets `fill`.
      const path = svg.querySelector('path') as SVGPathElement;
      const own = svg.getAttribute('fill') ?? path.getAttribute('fill');
      return own && own !== 'currentColor' ? own : window.getComputedStyle(svg).color;
    };
    await expect(fill('danger')).toMatch(/#d32f2f|rgb\(211, 47, 47\)/);
    await expect(fill('literal')).toMatch(/#123456|rgb\(18, 52, 86\)/);
  },
};

export const Accessibility: Story = {
  name: '♿ Accessibility',
  render: () => (
    <Box direction="row" gap={1}>
      <Icon name="Warning" dataTestId="decorative" />
      <Icon name="Warning" label="Atenção" dataTestId="named" />
    </Box>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('decorative')).toHaveAttribute('aria-hidden', 'true');
    const named = canvas.getByTestId('named');
    // MUI's SvgIcon names the glyph with a <title>; react-native-svg with aria-label.
    const name = named.getAttribute('aria-label') ?? named.querySelector('title')?.textContent;
    await expect(name).toBe('Atenção');
  },
};
