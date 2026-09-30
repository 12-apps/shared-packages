import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';

import { Screen } from './Screen';
import { Box } from '../Box/Box';
import { Input } from '../../form/Input/Input';
import { Text } from '../../typography/Text/Text';

const meta: Meta<typeof Screen> = {
  title: 'Layout/Screen', component: Screen, tags: ['autodocs', 'component:Screen'],
  parameters: { layout: 'fullscreen' },
  decorators: [(Story) => <Box height={320} direction="column"><Story /></Box>],
  args: { p: 2, gap: 2, dataTestId: 'screen' },
};
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { args: { children: <Text>Screen content</Text> } };
export const LongContent: Story = {
  render: (args) => <Screen {...args}>{Array.from({ length: 20 }, (_, i) => <Text key={i}>Row {i + 1}</Text>)}</Screen>,
};
export const TabBarOwnsBottom: Story = {
  args: { safeAreaEdges: ['top', 'left', 'right'], children: <Text>Bottom inset belongs to the navigator</Text> },
};
export const ChildOwnsScroll: Story = {
  render: (args) => <Screen {...args} scroll={false}>
    <Screen dataTestId="child" safeAreaEdges={[]} keyboardAvoiding={false}>
      {Array.from({ length: 20 }, (_, i) => <Text key={i}>Child row {i + 1}</Text>)}
    </Screen>
  </Screen>,
};
export const Empty: Story = { args: { children: null } };
export const KeyboardForm: Story = {
  render: (args) => <Screen {...args}>
    {Array.from({ length: 8 }, (_, i) => <Text key={i}>Form context {i + 1}</Text>)}
    <Input label="Load" type="number" dataTestId="load" />
  </Screen>,
};
