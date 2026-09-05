import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';

import { Icon } from './Icon';
import { ICON_NAMES } from './paths.generated';
import { Box } from '../components/layout/Box/Box';
import { Text } from '../components/typography/Text/Text';
import { COLOR_VALUES, SIZE_VALUES } from '../tokens/vocabulary';

const meta: Meta<typeof Icon> = {
  title: 'Utility/Icon',
  component: Icon,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'One glyph name, both renderers. The path data is generated from the installed `@mui/icons-material`, so the native icon is the web icon.',
      },
    },
  },
  tags: ['autodocs', 'component:Icon'],
  argTypes: {
    name: { control: { type: 'select' }, options: ICON_NAMES },
    size: { control: { type: 'select' }, options: SIZE_VALUES },
    color: { control: { type: 'select' }, options: [...COLOR_VALUES, 'inherit'] },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { name: 'CheckCircle', size: 'md', color: 'success', dataTestId: 'icon' },
};

export const Gallery: Story = {
  render: () => (
    <Box direction="row" gap={2} wrap>
      {ICON_NAMES.map((name) => (
        <Box key={name} align="center" gap={0.5} width={88} p={1} dataTestId={`glyph-${name}`}>
          <Icon name={name} />
          <Text size="xs" color="secondary">
            {name}
          </Text>
        </Box>
      ))}
    </Box>
  ),
};

export const Sizes: Story = {
  render: () => (
    <Box direction="row" gap={2} align="end">
      {SIZE_VALUES.map((size) => (
        <Icon key={size} name="Search" size={size} dataTestId={`size-${size}`} />
      ))}
      <Icon name="Search" size={48} dataTestId="size-48" />
    </Box>
  ),
};

export const Colors: Story = {
  render: () => (
    <Box direction="row" gap={2}>
      {COLOR_VALUES.map((color) => (
        <Icon key={color} name="Info" color={color} dataTestId={`color-${color}`} />
      ))}
    </Box>
  ),
};
