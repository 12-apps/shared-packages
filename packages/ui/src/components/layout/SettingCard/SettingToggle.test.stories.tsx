import type { Meta, StoryObj } from '@storybook/react-vite';
import React, { useRef, useState } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { EN_US_SETTING_SWITCH_COPY as COPY } from '../../../en-US';
import { SettingToggle } from './SettingToggle';

const meta: Meta<typeof SettingToggle> = {
  title: 'Layout/SettingToggle/Tests',
  component: SettingToggle,
  args: { copy: COPY },
  parameters: {
    layout: 'padded',
    chromatic: { disableSnapshot: false },
    docs: { description: { component: 'Interaction tests for SettingToggle: immediate async save.' } },
  },
  tags: ['autodocs', 'test', 'component:SettingToggle'],
};

export default meta;
export type Story = StoryObj<typeof meta>;

/** Saves stay pending until "release" (or fail, when `fail`), so each state is observed without a timer. */
function Harness({ fail = false }: { fail?: boolean }): React.ReactElement {
  const [checked, setChecked] = useState(false);
  const settle = useRef<{ resolve: () => void; reject: (e: unknown) => void } | null>(null);
  return (
    <>
      <SettingToggle
        copy={COPY}
        title="Dark mode"
        summary="Use the dark palette on this device."
        checked={checked}
        dataTestId="dark"
        onChange={async (next) => {
          await new Promise<void>((resolve, reject) => (settle.current = { resolve, reject }));
          setChecked(next);
        }}
      />
      <button
        type="button"
        data-testid="release"
        onClick={() => (fail ? settle.current?.reject(new Error('x')) : settle.current?.resolve())}
      >
        release
      </button>
    </>
  );
}

export const FlipSaves: Story = {
  name: 'Flip shows saving, then settles on',
  render: () => <Harness />,
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    const control = canvas.getByRole('switch', { name: 'Dark mode' });
    await step('Pending: shows the new value, busy, still focusable', async () => {
      await userEvent.click(control);
      await waitFor(() => expect(canvas.getByTestId('dark-saving')).toBeVisible());
      await expect(control).toBeChecked();
      await expect(control).toHaveAttribute('aria-busy', 'true');
      await expect(control).toBeEnabled();
      await expect(canvas.getByRole('status')).toHaveTextContent(COPY.saving);
    });
    await step('Resolved: on, not busy', async () => {
      await userEvent.click(canvas.getByTestId('release'));
      await waitFor(() => expect(control).toHaveAttribute('aria-busy', 'false'));
      await expect(control).toBeChecked();
    });
  },
};

export const RejectReverts: Story = {
  name: 'Rejected save flips back and shows the error',
  render: () => <Harness fail />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const control = canvas.getByRole('switch', { name: 'Dark mode' });
    await userEvent.click(control);
    await waitFor(() => expect(control).toBeChecked());
    await userEvent.click(canvas.getByTestId('release'));
    await waitFor(() => expect(canvas.getByTestId('dark-error')).toHaveTextContent(COPY.saveFailed));
    await expect(control).not.toBeChecked();
  },
};

export const KeyboardFlip: Story = {
  name: 'Keyboard: Space flips, focus stays on the switch while saving',
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const control = canvas.getByRole('switch', { name: 'Dark mode' });
    await userEvent.tab();
    await waitFor(() => expect(control).toHaveFocus());
    await userEvent.keyboard(' ');
    await waitFor(() => expect(control).toHaveAttribute('aria-busy', 'true'));
    await waitFor(() => expect(control).toHaveFocus());
    await userEvent.click(canvas.getByTestId('release'));
    await waitFor(() => expect(control).toHaveAttribute('aria-busy', 'false'));
  },
};

export const LabelIsTheTapTarget: Story = {
  name: 'Clicking the title flips the switch',
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId('dark-title'));
    await waitFor(() => expect(canvas.getByRole('switch', { name: 'Dark mode' })).toBeChecked());
    await userEvent.click(canvas.getByTestId('release'));
  },
};
