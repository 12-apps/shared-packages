import Box from '@mui/material/Box/index.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';

import { RegionMap } from './RegionMap';
import {
  REGION_MAP_AREAS,
  REGION_MAP_CENTER,
  REGION_MAP_COPY,
  REGION_MAP_WITH_EXCLUSIONS,
} from './RegionMap.fixtures';
import type { RegionMapProps } from './RegionMap.types';

const meta: Meta<typeof RegionMap> = {
  title: 'Data Display/RegionMap',
  component: RegionMap,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A hand-drawn map of named areas (polygons with holes) around a centre, where a tap ' +
          'toggles an area. Excluded areas are hatched and named, never only coloured. The list ' +
          'of toggle buttons beneath is the accessible way in, and reaches areas too small to tap.',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    regions: { control: false },
    copy: { control: false },
    onToggle: { action: 'toggled' },
    listMode: { control: { type: 'radio' }, options: ['shown', 'collapsed', 'none'] },
    maxHeight: { control: { type: 'text' } },
  },
  args: {
    regions: REGION_MAP_WITH_EXCLUSIONS,
    center: REGION_MAP_CENTER,
    circles: [{ radiusMetres: 3000 }],
    copy: REGION_MAP_COPY,
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** The toggle owned by the story, so a tap really hatches the area. */
function Interactive(props: RegionMapProps): React.JSX.Element {
  const [excluded, setExcluded] = React.useState<ReadonlySet<string>>(new Set());
  const regions = props.regions.map((r) => ({ ...r, excluded: excluded.has(r.id) }));
  return (
    <RegionMap
      {...props}
      regions={regions}
      onToggle={(id) =>
        setExcluded((current) => {
          const next = new Set(current);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        })
      }
    />
  );
}

export const TapToToggle: Story = {
  name: 'Tap to toggle',
  args: { regions: REGION_MAP_AREAS, listMode: 'shown' },
  render: (args) => <Interactive {...args} />,
};

export const Highlighted: Story = {
  name: 'Highlighted — a search result',
  args: { highlightedId: '3106200367' },
};

export const ReadOnly: Story = {
  name: 'Read-only — no onToggle',
  args: { onToggle: undefined, listMode: 'shown' },
};

export const NoCircles: Story = {
  name: 'No circles — the view fits the areas',
  args: { circles: [] },
};

export const Phone: Story = {
  name: 'At 320 px',
  render: (args) => (
    <Box sx={{ width: '20rem' }}>
      <RegionMap {...args} />
    </Box>
  ),
};

export const Desktop: Story = {
  name: 'At 1600 px, capped height',
  args: { maxHeight: '32rem', listMode: 'shown' },
  render: (args) => (
    <Box sx={{ width: '100rem' }}>
      <RegionMap {...args} />
    </Box>
  ),
};
