import type { Meta, StoryObj } from '@storybook/react-vite';
import React, { useState } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { EN_US_SETTING_SWITCH_COPY as COPY } from '../../../en-US';
import { SettingGroup } from './SettingGroup';
import { SettingToggle } from './SettingToggle';

const HINT = 'Turn backups on to choose how often they run.';

const meta: Meta<typeof SettingGroup> = {
  title: 'Layout/SettingGroup/Tests',
  component: SettingGroup,
  args: { copy: COPY, title: 'Backups', inactiveHint: HINT, checked: false, onChange: () => undefined, children: null },
  parameters: {
    layout: 'padded',
    chromatic: { disableSnapshot: false },
    docs: { description: { component: 'Interaction tests for SettingGroup: dependent rows dim, never vanish.' } },
  },
  tags: ['autodocs', 'test', 'component:SettingGroup'],
};

export default meta;
export type Story = StoryObj<typeof meta>;

function Harness(): React.ReactElement {
  const [on, setOn] = useState(false);
  const [daily, setDaily] = useState(true);
  return (
    <SettingGroup copy={COPY} title="Backups" inactiveHint={HINT} checked={on} onChange={setOn} dataTestId="backups">
      <SettingToggle variant="row" copy={COPY} title="Daily" checked={daily} onChange={setDaily} dataTestId="daily" />
      <label htmlFor="keep">Keep for (days)</label>
      <input id="keep" data-testid="keep" />
    </SettingGroup>
  );
}

export const OffDimsAndDisables: Story = {
  name: 'Off: rows stay, dimmed, unreachable, explained',
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const rows = canvas.getByTestId('backups-dependents');
    // Still rendered and on screen — the switch input itself is MUI's transparent
    // checkbox, so the row's visible title is what proves the row did not vanish.
    await expect(canvas.getByTestId('daily-title')).toBeVisible();
    await expect(canvas.getByTestId('keep')).toBeVisible();
    await expect(canvas.getByTestId('backups-hint')).toHaveTextContent(HINT);
    await expect(rows).toHaveAttribute('inert');
    await expect(Number(getComputedStyle(rows).opacity)).toBeLessThan(1);
    await expect(canvas.getByTestId('daily-switch')).toBeDisabled();
  },
};

export const OffRowsAreSkippedByTab: Story = {
  name: 'Off: Tab skips the dependent rows',
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.tab();
    await waitFor(() => expect(canvas.getByTestId('backups-switch')).toHaveFocus());
    await userEvent.tab();
    // Wherever the second Tab went, it is not inside the inert rows.
    await waitFor(() =>
      expect(canvas.getByTestId('backups-dependents').contains(document.activeElement)).toBe(false),
    );
  },
};

export const TurnOnActivates: Story = {
  name: 'On: rows light up and the hint goes',
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('switch', { name: 'Backups' }));
    await waitFor(() => expect(canvas.getByTestId('backups-dependents')).not.toHaveAttribute('inert'));
    await waitFor(() => expect(canvas.queryByTestId('backups-hint')).toBeNull());
    await expect(canvas.getByTestId('daily-switch')).toBeEnabled();
    await userEvent.type(canvas.getByTestId('keep'), '30');
    await expect(canvas.getByTestId('keep')).toHaveValue('30');
  },
};
