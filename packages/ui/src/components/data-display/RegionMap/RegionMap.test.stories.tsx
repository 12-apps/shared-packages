import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { RegionMap } from './RegionMap';
import { REGION_MAP_CENTER, REGION_MAP_COPY, REGION_MAP_WITH_EXCLUSIONS } from './RegionMap.fixtures';

const meta: Meta<typeof RegionMap> = {
  title: 'Data Display/RegionMap/Tests',
  component: RegionMap,
  parameters: { layout: 'padded', chromatic: { disableSnapshot: false } },
  tags: ['autodocs', 'test', 'component:RegionMap'],
  args: {
    regions: REGION_MAP_WITH_EXCLUSIONS,
    center: REGION_MAP_CENTER,
    circles: [{ radiusMetres: 3000 }],
    copy: REGION_MAP_COPY,
    dataTestId: 'map',
    onToggle: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const TapAnArea: Story = {
  name: '🧪 A tap on an area reports its id',
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId('map-area-3106200367'));
    await expect(args.onToggle).toHaveBeenCalledWith('3106200367');
  },
};

export const ExcludedAreNamed: Story = {
  name: '🧪 Excluded areas are hatched and named',
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('map-excluded-3106200484')).toBeInTheDocument();
    await expect(canvas.getByTestId('map-label-3106200484')).toHaveTextContent('Minascaixa');
  },
};

export const ListIsTheKeyboardWay: Story = {
  name: '🧪 The collapsed list opens and toggles from the keyboard',
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId('map-list-toggle'));
    const row = canvas.getByTestId('map-row-3106200484');
    await expect(row).toHaveAttribute('aria-pressed', 'true');
    // From the list toggle, Tab reaches the first row; the keyboard path is
    // the list's, not the drawing's.
    await userEvent.tab();
    await waitFor(() => expect(canvas.getByTestId('map-row-3106200190')).toHaveFocus());
    await userEvent.keyboard('{Enter}');
    await expect(args.onToggle).toHaveBeenCalledWith('3106200190');
  },
};
