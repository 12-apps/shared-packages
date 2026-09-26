import Box from '@mui/material/Box/index.js';
import Typography from '@mui/material/Typography/index.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import React, { useState } from 'react';

import { EN_US_SETTING_CARD_COPY, EN_US_SETTING_SWITCH_COPY } from '../../../en-US';
import { NumberField } from '../../form/NumberField';
import { SettingCard } from './SettingCard';
import { SettingGrid } from './SettingGrid';
import { SettingToggle } from './SettingToggle';

const meta: Meta<typeof SettingGrid> = {
  title: 'Layout/SettingGrid',
  component: SettingGrid,
  args: { children: null },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Lays setting cards out in 1, 2 or 3 columns by the width it is GIVEN, through CSS container queries rather than viewport media queries. Cards in one row share its height (grid row sizing, no measuring). A card open for editing spans the whole row.',
      },
    },
  },
  tags: ['autodocs', 'component:SettingGrid'],
  argTypes: {
    minColumnWidth: { control: { type: 'number', min: 160, step: 20 } },
    maxColumns: { control: 'inline-radio', options: [1, 2, 3] },
    gap: { control: { type: 'number', min: 0, max: 6 } },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

const noop = () => undefined;

/** Five cards of deliberately different heights. */
function Cards({ prefix = 'card' }: { prefix?: string }): React.ReactElement {
  const [minutes, setMinutes] = useState<number | null>(30);
  return (
    <>
      <SettingCard
        copy={EN_US_SETTING_CARD_COPY}
        title="Session timeout"
        summary={`Sign out after ${minutes ?? '—'} minutes`}
        status={{ label: 'On', color: 'success' }}
        learnMore="Shorter is safer on shared devices."
        onSave={() => new Promise((resolve) => setTimeout(resolve, 500))}
        dataTestId={`${prefix}-timeout`}
      >
        <NumberField label="Minutes" value={minutes} onChange={setMinutes} min={5} max={240} step={5} suffix="min" />
      </SettingCard>
      <SettingToggle
        copy={EN_US_SETTING_SWITCH_COPY}
        title="Two-step sign-in"
        summary="Ask for a code on a new device. Recommended for every account that can change billing or invite people."
        checked
        onChange={noop}
        dataTestId={`${prefix}-two-step`}
      />
      <SettingCard
        copy={EN_US_SETTING_CARD_COPY}
        title="Language"
        summary="English (United States)"
        onSave={noop}
        dataTestId={`${prefix}-language`}
      >
        <Typography variant="body2">A language picker goes here.</Typography>
      </SettingCard>
      <SettingToggle
        copy={EN_US_SETTING_SWITCH_COPY}
        title="Product news"
        checked={false}
        onChange={noop}
        dataTestId={`${prefix}-news`}
      />
      <SettingCard
        copy={EN_US_SETTING_CARD_COPY}
        title="Time zone"
        summary="Europe/Lisbon"
        status={{ label: 'Automatic', color: 'info' }}
        onSave={noop}
        dataTestId={`${prefix}-tz`}
      >
        <Typography variant="body2">A zone picker goes here.</Typography>
      </SettingCard>
    </>
  );
}

/** Resize the canvas: the column count follows the grid's own width. */
export const Default: Story = {
  render: (args) => (
    <SettingGrid {...args} aria-label="Account settings">
      <Cards />
    </SettingGrid>
  ),
};

/**
 * The same grid at three CONTAINER widths on one page — the point of container
 * queries. The viewport is identical for all three; only the space each grid
 * is given differs.
 */
export const ResponsiveByContainer: Story = {
  parameters: { layout: 'fullscreen' },
  render: () => (
    <Box sx={{ display: 'grid', gap: 4, p: 2 }}>
      {[360, 720, 1080].map((width) => (
        <Box key={width} sx={{ width, maxWidth: '100%', outline: '1px dashed', outlineColor: 'divider', p: 1 }}>
          <Typography variant="overline">{`${width}px container`}</Typography>
          <SettingGrid dataTestId={`grid-${width}`}>
            <Cards prefix={`w${width}`} />
          </SettingGrid>
        </Box>
      ))}
    </Box>
  ),
};

/** A card mid-edit takes the whole row, wherever it sat. */
export const OpenCardSpansRow: Story = {
  render: () => (
    <Box sx={{ width: 1080, maxWidth: '100%' }}>
      <SettingGrid>
        <SettingToggle copy={EN_US_SETTING_SWITCH_COPY} title="Product news" checked={false} onChange={noop} />
        <SettingCard copy={EN_US_SETTING_CARD_COPY} title="Session timeout" summary="30 minutes" defaultOpen onSave={noop}>
          <NumberField label="Minutes" value={30} onChange={noop} suffix="min" />
        </SettingCard>
        <SettingToggle copy={EN_US_SETTING_SWITCH_COPY} title="Tips" checked onChange={noop} />
      </SettingGrid>
    </Box>
  ),
};

/** `maxColumns={2}`: a wide container still stops at two. */
export const TwoColumnsMax: Story = {
  render: () => (
    <Box sx={{ width: 1080, maxWidth: '100%' }}>
      <SettingGrid maxColumns={2}>
        <Cards />
      </SettingGrid>
    </Box>
  ),
};

/** Nothing inside: the grid draws nothing of its own. */
export const Empty: Story = {
  render: () => <SettingGrid dataTestId="empty-grid">{null}</SettingGrid>,
};
