import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { Screen } from './Screen';
import { Box } from '../Box/Box';
import { Input } from '../../form/Input/Input';
import { Text } from '../../typography/Text/Text';

const meta: Meta<typeof Screen> = {
  title: 'Layout/Screen/Tests', component: Screen, tags: ['autodocs', 'test', 'component:Screen'],
  parameters: { layout: 'fullscreen' },
  decorators: [(Story) => <Box height={240} direction="column"><Story /></Box>],
};
export default meta;
type Story = StoryObj<typeof meta>;
export const BoundedOverflow: Story = {
  render: () => <Screen dataTestId="long" p={2} gap={1}>
    {Array.from({ length: 30 }, (_, i) => <Text key={i}>Row {i + 1}</Text>)}
  </Screen>,
  play: async ({ canvasElement }) => {
    const viewport = await within(canvasElement).findByTestId('long-viewport');
    /* eslint-disable test-flakiness/no-viewport-dependent -- scrolling is the subject; the decorator pins this viewport to 240 design px independent of the browser window */
    await expect(viewport.scrollHeight).toBeGreaterThan(viewport.clientHeight);
    viewport.scrollTop = viewport.scrollHeight;
    await expect(viewport.scrollTop).toBeGreaterThan(0);
    /* eslint-enable test-flakiness/no-viewport-dependent */
  },
};
export const InputRemainsInteractive: Story = {
  render: () => <Screen dataTestId="form" p={2}><Input dataTestId="load" label="Load" /></Screen>,
  play: async ({ canvasElement }) => {
    const input = await within(canvasElement).findByTestId('load');
    await userEvent.click(input);
    await userEvent.type(input, '42');
    await expect(input).toHaveValue('42');
  },
};
export const EmptyScreen: Story = {
  render: () => <Screen dataTestId="empty" safeAreaEdges={[]} />,
  play: async ({ canvasElement }) => { await expect(await within(canvasElement).findByTestId('empty')).toBeVisible(); },
};

export const ChildViewportStaysBounded: Story = {
  render: () => <Screen scroll={false} p={2}>
    <Screen dataTestId="child" safeAreaEdges={[]} keyboardAvoiding={false}>
      {Array.from({ length: 30 }, (_, i) => <Text key={i}>Child row {i + 1}</Text>)}
    </Screen>
  </Screen>,
  play: async ({ canvasElement }) => {
    const viewport = await within(canvasElement).findByTestId('child-viewport');
    await expect(viewport.clientHeight).toBeGreaterThan(0);
    /* eslint-disable test-flakiness/no-viewport-dependent -- scrolling is the subject; the decorator pins this viewport to 240 design px independent of the browser window */
    await expect(viewport.scrollHeight).toBeGreaterThan(viewport.clientHeight);
    viewport.scrollTop = viewport.scrollHeight;
    await expect(viewport.scrollTop).toBeGreaterThan(0);
    /* eslint-enable test-flakiness/no-viewport-dependent */
  },
};
