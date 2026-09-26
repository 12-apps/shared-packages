import Box from '@mui/material/Box/index.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import React, { useState } from 'react';

import { EN_US_SETTING_CARD_COPY, EN_US_SETTING_SWITCH_COPY } from '../../../en-US';
import { NumberField } from '../../form/NumberField';
import { SettingCard } from './SettingCard';
import { SettingGrid } from './SettingGrid';
import { SettingGroup } from './SettingGroup';
import { SettingToggle } from './SettingToggle';
import type { SettingGroupProps } from './SettingCard.types';

const meta: Meta<typeof SettingGroup> = {
  title: 'Layout/SettingGroup',
  component: SettingGroup,
  args: {
    copy: EN_US_SETTING_SWITCH_COPY,
    title: 'Notifications',
    summary: 'What we tell you about, and when.',
    inactiveHint: 'Turn notifications on to choose which ones you get.',
    checked: false,
    onChange: () => undefined,
    children: null,
    dataTestId: 'notifications',
  },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'ONE subject: a main switch plus the dependent settings that only mean something while it is on, indented below it. With the main switch off the rows stay visible — dimmed, inert, and explained by `inactiveHint`. Different subjects are separate cards, never one group.',
      },
    },
  },
  tags: ['autodocs', 'component:SettingGroup'],
};

export default meta;
type Story = StoryObj<typeof meta>;

const wait = () => new Promise((resolve) => setTimeout(resolve, 500));

/** A notifications group with three dependent rows, each persisted on its own. */
function Notifications({ initial = false, ...props }: Partial<SettingGroupProps> & { initial?: boolean }): React.ReactElement {
  const [on, setOn] = useState(initial);
  const [digest, setDigest] = useState(true);
  const [mentions, setMentions] = useState(false);
  const [quietFrom, setQuietFrom] = useState<number | null>(22);
  return (
    <SettingGroup
      {...(meta.args as SettingGroupProps)}
      {...props}
      checked={on}
      onChange={async (next) => {
        await wait();
        setOn(next);
      }}
    >
      <SettingToggle
        variant="row"
        copy={EN_US_SETTING_SWITCH_COPY}
        title="Weekly digest"
        summary="One e-mail on Monday with the week's activity."
        checked={digest}
        onChange={async (next) => {
          await wait();
          setDigest(next);
        }}
      />
      <SettingToggle
        variant="row"
        copy={EN_US_SETTING_SWITCH_COPY}
        title="Mentions"
        summary="Right away, whenever someone mentions you."
        checked={mentions}
        onChange={async (next) => {
          await wait();
          setMentions(next);
        }}
      />
      <Box sx={{ py: 1.5, maxWidth: 240 }}>
        <NumberField label="Quiet hours from" value={quietFrom} onChange={setQuietFrom} min={0} max={23} suffix="h" />
      </Box>
    </SettingGroup>
  );
}

/** The single-card stories sit at a card's width, not the canvas's. */
const narrow: NonNullable<Story['decorators']> = [
  (Story) => (
    <Box sx={{ maxWidth: 520 }}>
      <Story />
    </Box>
  ),
];

/** Main switch off: the rows are dimmed and inert, and the hint says why. */
export const Off: Story = { decorators: narrow, render: () => <Notifications /> };

/** Main switch on: the rows are live. */
export const On: Story = { decorators: narrow, render: () => <Notifications initial /> };

/** Off because the host disabled it (a plan limit, a policy). */
export const Disabled: Story = { decorators: narrow, render: () => <Notifications initial disabled /> };

/**
 * The rule the component exists for: one group per SUBJECT.
 *
 * Notifications and their channels are one subject — the rows are meaningless
 * with notifications off. Session timeout and two-step sign-in are different
 * subjects that happen to sit on the same page, so they are separate cards,
 * each with its own title, state and save.
 */
export const OneSubjectPerGroup: Story = {
  render: () => (
    <SettingGrid aria-label="Account settings" sx={{ maxWidth: 1100 }}>
      <Notifications initial />
      <SettingToggle
        copy={EN_US_SETTING_SWITCH_COPY}
        title="Two-step sign-in"
        summary="Ask for a code on a new device."
        checked
        onChange={wait}
      />
      <SettingCard
        copy={EN_US_SETTING_CARD_COPY}
        title="Session timeout"
        summary="Sign out after 30 minutes"
        status={{ label: 'On', color: 'success' }}
        onSave={wait}
      >
        <NumberField label="Minutes" value={30} onChange={() => undefined} suffix="min" />
      </SettingCard>
    </SettingGrid>
  ),
};
