import Box from '@mui/material/Box/index.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import React, { useState } from 'react';
import { userEvent, within } from 'storybook/test';

import { EN_US_SETTING_SWITCH_COPY } from '../../../en-US';
import { Icon } from '../../../icons';
import { SettingToggle } from './SettingToggle';
import type { SettingToggleProps } from './SettingCard.types';

const meta: Meta<typeof SettingToggle> = {
  title: 'Layout/SettingToggle',
  component: SettingToggle,
  args: {
    copy: EN_US_SETTING_SWITCH_COPY,
    title: 'Two-step sign-in',
    summary: 'Ask for a code from your phone when signing in on a new device.',
    checked: false,
    onChange: () => undefined,
    dataTestId: 'two-step',
  },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A setting that is one switch. No edit state: flipping it saves at once. `onChange` may return a promise — the switch shows the new value with a spinner while it is pending, and flips back with the error if it rejects. `variant="row"` draws it flat, for a dependent row inside a `SettingGroup`.',
      },
    },
  },
  tags: ['autodocs', 'component:SettingToggle'],
  argTypes: {
    variant: { control: 'inline-radio', options: ['card', 'row'] },
    disabled: { control: 'boolean' },
    checked: { control: 'boolean' },
  },
  decorators: [
    (Story) => (
      <Box sx={{ maxWidth: 480 }}>
        <Story />
      </Box>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

/** A host that owns `checked` and persists through `save`. */
function Persisted({
  save = () => new Promise((resolve) => setTimeout(resolve, 600)),
  initial = false,
  ...props
}: Partial<SettingToggleProps> & { save?: () => Promise<unknown>; initial?: boolean }): React.ReactElement {
  const [checked, setChecked] = useState(initial);
  return (
    <SettingToggle
      {...(meta.args as SettingToggleProps)}
      {...props}
      checked={checked}
      onChange={async (next) => {
        await save();
        setChecked(next);
      }}
    />
  );
}

export const Default: Story = { render: () => <Persisted /> };

export const On: Story = { render: () => <Persisted initial /> };

export const WithIcon: Story = { render: () => <Persisted icon={<Icon name="Info" size="sm" />} /> };

/** Flipped and still saving: the new value, a spinner, "Saving…" announced. */
export const Saving: Story = {
  render: () => <Persisted save={() => new Promise(() => undefined)} />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('two-step-switch'));
  },
};

/** The save rejected: the switch is back where it was, with the error under it. */
export const SaveRejected: Story = {
  render: () => <Persisted save={() => Promise.reject(new Error('offline'))} />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('two-step-switch'));
  },
};

export const Disabled: Story = { render: () => <Persisted disabled initial /> };

/** `variant="row"`: the same content with no surface, stacked. */
export const Rows: Story = {
  render: () => (
    <Box>
      <Persisted variant="row" title="Product news" summary="A monthly e-mail about new features." dataTestId="row-news" />
      <Persisted variant="row" title="Tips" summary="Short hints while you work." initial dataTestId="row-tips" />
    </Box>
  ),
};

export const LongContent: Story = {
  render: () => (
    <Persisted
      title="Require a second step every time anyone signs in from a device this account has never used before"
      summary="A code is sent to the phone on file. Without it, the sign-in is refused and the account owner is told by e-mail, with the device, the browser, the approximate place and the time."
    />
  ),
};
