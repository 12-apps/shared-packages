import AddIcon from '@mui/icons-material/Add';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import Box from '@mui/material/Box/index.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';

import { EN_US_SECTION_NAV_COPY } from '../../../en-US.navigation';

import { sxRem } from '../../../tokens/scales';

import { SectionNav } from './SectionNav';
import { RaisedActionButton } from './SectionNav.primary';
import { ACTIONS, DESTINATIONS, MORE, PAY_ALL, PRIMARY, PhoneFrame, RailFrame } from './__stories__/fixtures';

const meta: Meta<typeof SectionNav> = {
  title: 'Navigation/SectionNav',
  component: SectionNav,
  args: {
    layout: 'bar',
    label: 'Operations',
    destinations: DESTINATIONS,
    primary: PRIMARY,
    more: MORE,
    copy: EN_US_SECTION_NAV_COPY,
  },
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          "A section's own navigation — the few screens one kind of work moves between. `bar` is a phone bottom bar: destinations, `more` as the last slot opening a sheet, and `primary` as a raised button in the middle opening its own sheet. `rail` is the wide-screen equivalent: a way back, the destinations, and every menu listed rather than folded. Every word, icon, href and count is the host's.",
      },
    },
  },
  tags: ['autodocs', 'component:SectionNav'],
  argTypes: {
    layout: { control: 'inline-radio', options: ['bar', 'rail'] },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

/** Four destinations and the raised action — the full phone bar. */
export const Bar: Story = {
  render: (args) => (
    <PhoneFrame>
      <SectionNav {...args} />
    </PhoneFrame>
  ),
};

/** No primary action: the destinations and `more` share the row evenly. */
export const BarWithoutPrimary: Story = {
  args: { primary: undefined },
  render: (args) => (
    <PhoneFrame>
      <SectionNav {...args} />
    </PhoneFrame>
  ),
};

/**
 * A bar of VERBS: action slots (one disabled, one lit), a raised primary that
 * acts on tap with its label under it, and `more` as a sheet of actions.
 */
export const ActionBar: Story = {
  args: { label: 'Settle the bill', destinations: ACTIONS, primary: PAY_ALL },
  render: (args) => (
    <PhoneFrame>
      <SectionNav {...args} />
    </PhoneFrame>
  ),
};

/** The wide-screen rail, with the way back out of the section. */
export const Rail: Story = {
  args: {
    layout: 'rail',
    heading: 'Operations',
    back: { label: 'Back', href: '#home', icon: <ArrowBackIcon /> },
  },
  render: (args) => (
    <RailFrame>
      <SectionNav {...args} />
    </RailFrame>
  ),
};

/** The raised button alone, for a bar the host already draws. */
export const RaisedButtonInAHostBar: Story = {
  render: () => (
    <Box sx={{ width: sxRem(360), display: 'flex', alignItems: 'stretch', gap: 1, pt: 3, px: 1, pb: 1, borderTop: 1, borderColor: 'divider' }}>
      <Box sx={{ flex: 1, textAlign: 'center' }}>Menu</Box>
      <Box sx={{ flex: 1, textAlign: 'center' }}>Tab</Box>
      <RaisedActionButton label="Add" icon={<AddIcon />} onClick={() => undefined} />
      <Box sx={{ flex: 1, textAlign: 'center' }}>Call</Box>
      <Box sx={{ flex: 1, textAlign: 'center' }}>More</Box>
    </Box>
  ),
};
