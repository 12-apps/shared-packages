import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { expect, within } from 'storybook/test';

import { Stack } from './Stack';
import { Box } from '../Box/Box';
import { Text } from '../../typography/Text/Text';

const meta: Meta<typeof Stack> = {
  title: 'Layout/Stack/Tests',
  component: Stack,
  parameters: { layout: 'centered', chromatic: { disableSnapshot: false } },
  tags: ['autodocs', 'test', 'component:Stack'],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const ColumnByDefault: Story = {
  name: '⬇️ Column By Default',
  render: () => (
    <Stack dataTestId="col">
      <Box dataTestId="a" p={1} bg="primary" />
      <Box dataTestId="b" p={1} bg="secondary" />
    </Stack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const style = window.getComputedStyle(canvas.getByTestId('col'));
    await expect(style.display).toBe('flex');
    await expect(style.flexDirection).toBe('column');
    const a = canvas.getByTestId('a').getBoundingClientRect();
    const b = canvas.getByTestId('b').getBoundingClientRect();
    await expect(b.top).toBeGreaterThanOrEqual(a.bottom);
  },
};

export const RowWithGap: Story = {
  name: '↔️ Row With Gap',
  render: () => (
    <Stack direction="row" gap={2} dataTestId="row">
      <Box dataTestId="a" width={20} height={20} bg="primary" />
      <Box dataTestId="b" width={20} height={20} bg="secondary" />
    </Stack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(window.getComputedStyle(canvas.getByTestId('row')).gap).toBe('16px');
    const a = canvas.getByTestId('a').getBoundingClientRect();
    const b = canvas.getByTestId('b').getBoundingClientRect();
    await expect(Math.round(b.left - a.right)).toBe(16);
  },
};

export const DividerBetweenChildren: Story = {
  name: '➖ Divider Between Children',
  render: () => (
    <Stack dataTestId="divided" divider={<Box height={1} bg="neutral" dataTestId="divider" />}>
      <Text>Primeiro</Text>
      <Text>Segundo</Text>
      <Text>Terceiro</Text>
    </Stack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByTestId('divider')).toHaveLength(2);
    const stack = canvas.getByTestId('divided');
    await expect(stack.firstElementChild).toHaveTextContent('Primeiro');
    await expect(stack.lastElementChild).toHaveTextContent('Terceiro');
  },
};
