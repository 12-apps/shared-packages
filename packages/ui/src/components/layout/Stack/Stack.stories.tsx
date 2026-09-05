import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';

import { Stack } from './Stack';
import { Box } from '../Box/Box';
import { Text } from '../../typography/Text/Text';

const meta: Meta<typeof Stack> = {
  title: 'Layout/Stack',
  component: Stack,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          "MUI's Stack on the neutral prop set: always a flex container, `column` with no gap by default, an optional divider between children. Renders on both the web and React Native.",
      },
    },
  },
  tags: ['autodocs', 'component:Stack'],
  argTypes: {
    direction: { control: { type: 'select' }, options: ['row', 'column'] },
    gap: { control: { type: 'number', min: 0, max: 8, step: 0.5 } },
    align: { control: { type: 'select' }, options: ['start', 'center', 'end', 'stretch', 'baseline'] },
    justify: { control: { type: 'select' }, options: ['start', 'center', 'end', 'between', 'around', 'evenly'] },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

const Item = ({ label }: { label: string }) => (
  <Box p={1} bg="primary" radius="sm" dataTestId={`item-${label}`}>
    <Text color="primary">{label}</Text>
  </Box>
);

export const Default: Story = {
  args: { gap: 1, dataTestId: 'stack' },
  render: (args) => (
    <Stack {...args}>
      <Item label="a" />
      <Item label="b" />
      <Item label="c" />
    </Stack>
  ),
};

export const Row: Story = {
  args: { direction: 'row', gap: 2, align: 'center', dataTestId: 'row' },
  render: (args) => (
    <Stack {...args}>
      <Item label="a" />
      <Item label="b" />
      <Item label="c" />
    </Stack>
  ),
};

export const WithDivider: Story = {
  args: { gap: 1, dataTestId: 'divided' },
  render: (args) => (
    <Stack {...args} divider={<Box height={1} bg="neutral" dataTestId="divider" />}>
      <Text>Primeiro</Text>
      <Text>Segundo</Text>
      <Text>Terceiro</Text>
    </Stack>
  ),
};
