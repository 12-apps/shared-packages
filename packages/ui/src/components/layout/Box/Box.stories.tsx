import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';

import { Box } from './Box';
import { Text } from '../../typography/Text/Text';

const meta: Meta<typeof Box> = {
  title: 'Layout/Box',
  component: Box,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The layout primitive both renderers share: spacing-scale props resolved to the same numbers on the web (into `sx`) and on React Native (into `style`).',
      },
    },
  },
  tags: ['autodocs', 'component:Box'],
  argTypes: {
    p: { control: { type: 'number', min: 0, max: 8, step: 0.5 }, description: 'Padding, in spacing units' },
    gap: { control: { type: 'number', min: 0, max: 8, step: 0.5 }, description: 'Gap between children, in spacing units' },
    direction: { control: { type: 'select' }, options: ['row', 'column', 'row-reverse', 'column-reverse'] },
    align: { control: { type: 'select' }, options: ['start', 'center', 'end', 'stretch', 'baseline'] },
    justify: { control: { type: 'select' }, options: ['start', 'center', 'end', 'between', 'around', 'evenly'] },
    bg: {
      control: { type: 'select' },
      options: ['default', 'paper', 'transparent', 'primary', 'secondary', 'success', 'warning', 'info', 'danger', 'neutral'],
    },
    radius: { control: { type: 'select' }, options: ['sm', 'md', 'lg', 'xl', 'full'] },
    bordered: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { p: 2, bg: 'paper', bordered: true, radius: 'md', dataTestId: 'box' },
  render: (args) => (
    <Box {...args}>
      <Text>Uma caixa com padding de duas unidades.</Text>
    </Box>
  ),
};

export const Row: Story = {
  args: { direction: 'row', gap: 2, align: 'center', p: 1, bg: 'paper', bordered: true, dataTestId: 'row' },
  render: (args) => (
    <Box {...args}>
      <Box p={1} bg="primary" radius="sm" dataTestId="cell-1">
        <Text color="primary">1</Text>
      </Box>
      <Box p={2} bg="secondary" radius="sm" dataTestId="cell-2">
        <Text color="primary">2</Text>
      </Box>
      <Box p={3} bg="info" radius="sm" dataTestId="cell-3">
        <Text color="primary">3</Text>
      </Box>
    </Box>
  ),
};

export const Surfaces: Story = {
  render: () => (
    <Box direction="row" gap={1} wrap>
      {(['default', 'paper', 'primary', 'secondary', 'success', 'warning', 'info', 'danger', 'neutral'] as const).map(
        (bg) => (
          <Box key={bg} bg={bg} p={2} radius="lg" width={96} height={64} dataTestId={`surface-${bg}`} />
        ),
      )}
    </Box>
  ),
};

export const Radii: Story = {
  render: () => (
    <Box direction="row" gap={2} align="end">
      {(['sm', 'md', 'lg', 'xl', 'full'] as const).map((radius) => (
        <Box key={radius} bg="primary" radius={radius} width={56} height={56} dataTestId={`radius-${radius}`} />
      ))}
    </Box>
  ),
};
