import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { expect, within } from 'storybook/test';

import { Box } from './Box';
import { Text } from '../../typography/Text/Text';

const meta: Meta<typeof Box> = {
  title: 'Layout/Box/Tests',
  component: Box,
  parameters: { layout: 'centered', chromatic: { disableSnapshot: false } },
  tags: ['autodocs', 'test', 'component:Box'],
};

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The same numbers on both renderers: these assertions read the painted
 * style, so they pass against MUI's `sx` and against react-native-web alike.
 */
export const SpacingScale: Story = {
  name: '📏 Spacing Scale',
  render: () => (
    <Box p={2} px={3} mt={1} dataTestId="scale">
      <Text>scale</Text>
    </Box>
  ),
  play: async ({ canvasElement }) => {
    const box = within(canvasElement).getByTestId('scale');
    const style = window.getComputedStyle(box);
    await expect(style.paddingTop).toBe('16px');
    await expect(style.paddingBottom).toBe('16px');
    await expect(style.paddingLeft).toBe('24px');
    await expect(style.paddingRight).toBe('24px');
    await expect(style.marginTop).toBe('8px');
  },
};

export const FlexRow: Story = {
  name: '↔️ Flex Row',
  render: () => (
    <Box direction="row" gap={1} align="center" justify="between" width={240} dataTestId="flex">
      <Box dataTestId="a" p={1} bg="primary" />
      <Box dataTestId="b" p={1} bg="secondary" />
    </Box>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const style = window.getComputedStyle(canvas.getByTestId('flex'));
    await expect(style.display).toBe('flex');
    await expect(style.flexDirection).toBe('row');
    await expect(style.alignItems).toBe('center');
    await expect(style.justifyContent).toBe('space-between');
    await expect(style.gap).toBe('8px');
    const a = canvas.getByTestId('a').getBoundingClientRect();
    const b = canvas.getByTestId('b').getBoundingClientRect();
    await expect(b.left).toBeGreaterThan(a.right);
  },
};

export const SurfaceAndBorder: Story = {
  name: '🎨 Surface and Border',
  render: () => <Box p={2} bg="primary" radius="lg" bordered dataTestId="surface" />,
  play: async ({ canvasElement }) => {
    const style = window.getComputedStyle(within(canvasElement).getByTestId('surface'));
    await expect(style.backgroundColor).toBe('rgb(99, 102, 241)');
    await expect(style.borderTopLeftRadius).toBe('8px');
    await expect(style.borderTopWidth).toBe('1px');
  },
};

export const BlockByDefault: Story = {
  name: '⬛ Block By Default',
  render: () => (
    <Box dataTestId="block">
      <Text>plain</Text>
    </Box>
  ),
  // react-native-web's View is always a flex column; MUI's Box is a block.
  // Stacked children look the same either way, so only the web asserts `block`.
  tags: ['native-skip'],
  play: async ({ canvasElement }) => {
    const style = window.getComputedStyle(within(canvasElement).getByTestId('block'));
    await expect(style.display).toBe('block');
  },
};
