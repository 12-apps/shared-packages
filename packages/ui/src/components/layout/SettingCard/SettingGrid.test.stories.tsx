import Box from '@mui/material/Box/index.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { EN_US_SETTING_CARD_COPY, EN_US_SETTING_SWITCH_COPY } from '../../../en-US';
import { SettingCard } from './SettingCard';
import { SettingGrid } from './SettingGrid';
import { SettingToggle } from './SettingToggle';

/**
 * LAYOUT, measured in a real browser — the half jsdom cannot see. Every grid
 * here sits in a container of a fixed width, so the column count is decided by
 * the container query and not by whatever the viewport happens to be.
 */
const meta: Meta<typeof SettingGrid> = {
  title: 'Layout/SettingGrid/Tests',
  component: SettingGrid,
  args: { children: null },
  parameters: { layout: 'fullscreen', chromatic: { disableSnapshot: false } },
  tags: ['autodocs', 'test', 'component:SettingGrid'],
};

export default meta;
export type Story = StoryObj<typeof meta>;

const noop = () => undefined;

/** Three cards, the second with far more text than the others. */
function Fixture({ width, id }: { width: number; id: string }): React.ReactElement {
  return (
    <Box sx={{ width }}>
      <SettingGrid dataTestId={id}>
        <SettingToggle copy={EN_US_SETTING_SWITCH_COPY} title="A" checked={false} onChange={noop} dataTestId={`${id}-a`} />
        <SettingCard
          copy={EN_US_SETTING_CARD_COPY}
          title="B"
          summary="short"
          learnMore="x"
          onSave={noop}
          dataTestId={`${id}-b`}
        >
          <input data-testid={`${id}-b-input`} />
        </SettingCard>
        <SettingToggle
          copy={EN_US_SETTING_SWITCH_COPY}
          title="C"
          summary={'A long explanation that wraps onto several lines. '.repeat(4)}
          checked
          onChange={noop}
          dataTestId={`${id}-c`}
        />
      </SettingGrid>
    </Box>
  );
}

const rect = (element: HTMLElement) => element.getBoundingClientRect();
const columnsOf = (canvas: ReturnType<typeof within>, id: string) =>
  new Set(['a', 'b', 'c'].map((part) => Math.round(rect(canvas.getByTestId(`${id}-${part}`)).left))).size;

export const ColumnsFollowTheContainer: Story = {
  name: '1, 2 and 3 columns by container width',
  render: () => (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Fixture width={360} id="narrow" />
      <Fixture width={720} id="medium" />
      <Fixture width={1080} id="wide" />
    </Box>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(columnsOf(canvas, 'narrow')).toBe(1));
    await expect(columnsOf(canvas, 'medium')).toBe(2);
    await expect(columnsOf(canvas, 'wide')).toBe(3);
  },
};

export const RowsShareHeight: Story = {
  name: 'Cards in one row are equally tall',
  render: () => <Fixture width={1080} id="row" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const heights = () => ['a', 'b', 'c'].map((part) => Math.round(rect(canvas.getByTestId(`row-${part}`)).height));
    await waitFor(() => expect(new Set(heights()).size).toBe(1));
    // …and the row really is sized by the tall card, not collapsed to the short ones.
    await expect(heights()[0]).toBeGreaterThan(Math.round(rect(canvas.getByTestId('row-b-title')).height) * 3);
  },
};

export const OpenCardSpansTheRow: Story = {
  name: 'An open card takes the whole row',
  render: () => <Fixture width={1080} id="span" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const grid = canvas.getByTestId('span-grid');
    await waitFor(() => expect(rect(canvas.getByTestId('span-b')).width).toBeLessThan(rect(grid).width / 2));
    await userEvent.click(canvas.getByTestId('span-b-edit'));
    await waitFor(() => expect(Math.round(rect(canvas.getByTestId('span-b')).width)).toBe(Math.round(rect(grid).width)));
    await userEvent.click(canvas.getByTestId('span-b-cancel'));
    await waitFor(() => expect(rect(canvas.getByTestId('span-b')).width).toBeLessThan(rect(grid).width / 2));
  },
};
