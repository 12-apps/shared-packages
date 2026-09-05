import Box from '@mui/material/Box/index.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';

import { FleetMap } from './FleetMap';
import { FLEET, FLEET_COPY } from './FleetMap.fixtures';

const meta: Meta<typeof FleetMap> = {
  title: 'Data Display/FleetMap',
  component: FleetMap,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Where a set of tracked units is right now: a map beside the roster that reads it. ' +
          'Product-free — every word, and the two formatters, arrive through `copy`. The roster ' +
          'is the ACCESSIBLE representation and the map is marked decorative, because a screen ' +
          'reader cannot read a picture.',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    units: { control: false },
    copy: { control: false },
    onSelect: { action: 'selected' },
    laggingAfterSeconds: { control: { type: 'number' } },
    staleAfterSeconds: { control: { type: 'number' } },
    height: { control: { type: 'text' } },
    loading: { control: { type: 'boolean' } },
  },
  args: { units: FLEET, copy: FLEET_COPY },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = {
  name: 'Empty — nobody reporting',
  args: { units: [] },
  parameters: {
    docs: {
      description: {
        story:
          'An empty fleet renders an empty STATE, never an empty map: a map with no pins is ' +
          'indistinguishable from one that failed to load, and telling those apart is the whole ' +
          'question a dispatcher is asking.',
      },
    },
  },
};

export const Loading: Story = {
  args: { loading: true },
};

export const OneCourier: Story = {
  name: 'One courier',
  args: { units: [FLEET[0]!] },
};

export const AllStale: Story = {
  name: 'Everyone stale — the shift ended',
  args: {
    units: FLEET.map((unit) => ({ ...unit, staleSeconds: 3_600 })),
  },
};

export const TightThresholds: Story = {
  name: 'Tight thresholds — a five-second fleet',
  args: { laggingAfterSeconds: 5, staleAfterSeconds: 20 },
  parameters: {
    docs: {
      description: {
        story:
          'The thresholds are props with no domain default because the answer belongs entirely ' +
          'to the fleet’s own ping cadence. The same three units read differently here.',
      },
    },
  },
};

export const LongNames: Story = {
  name: 'Edge case — long names and no accuracy',
  args: {
    units: [
      {
        id: 'long',
        label: 'Maria Aparecida do Nascimento Gonçalves Ferreira',
        latitude: -23.55,
        longitude: -46.63,
        staleSeconds: 20,
        badge: '12 deliveries',
      },
      ...FLEET.slice(1),
    ],
  },
};

/** Selection is CONTROLLED, so the docs page shows it driven from outside. */
function SelectableFleet(): React.JSX.Element {
  const [selected, setSelected] = React.useState<string | null>('bruno');
  return (
    <Box>
      <FleetMap
        units={FLEET}
        copy={FLEET_COPY}
        selectedId={selected}
        onSelect={setSelected}
        dataTestId="selectable-fleet"
      />
    </Box>
  );
}

export const Selectable: Story = {
  name: 'Selected — the map follows the roster',
  render: () => <SelectableFleet />,
  parameters: {
    docs: {
      description: {
        story:
          'Clicking a row, or arrowing through the list, moves the selection; the map centres ' +
          'on whoever is selected and falls back to the fleet’s centroid when nobody is.',
      },
    },
  },
};

export const Short: Story = {
  name: 'Compact height',
  args: { height: '240px' },
};
