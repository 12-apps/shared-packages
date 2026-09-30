import Box from '@mui/material/Box/index.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import React, { useRef, useState } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { EN_US_SETTING_CARD_COPY as COPY } from '../../../en-US';
import { SettingCard } from './SettingCard';
import type { SettingCardProps } from './SettingCard.types';

const meta: Meta<typeof SettingCard> = {
  title: 'Layout/SettingCard/Tests',
  component: SettingCard,
  args: { copy: COPY },
  parameters: {
    layout: 'padded',
    chromatic: { disableSnapshot: false },
    docs: { description: { component: 'Interaction tests for SettingCard: in-place edit, async save, focus round trip.' } },
  },
  tags: ['autodocs', 'test', 'component:SettingCard'],
};

export default meta;
export type Story = StoryObj<typeof meta>;

/** A card around one text field, with the save outcome chosen by the story. */
function Harness(props: Partial<SettingCardProps>): React.ReactElement {
  const [saved, setSaved] = useState('Europe/Lisbon');
  const [draft, setDraft] = useState(saved);
  return (
    <Box sx={{ maxWidth: 520 }}>
      <SettingCard
        copy={COPY}
        title="Time zone"
        summary={saved}
        status={{ label: 'Set', color: 'success' }}
        learnMore="Dates in reports and e-mails are shown in this zone."
        dataTestId="tz"
        {...props}
        onCancel={() => setDraft(saved)}
        onSave={async () => {
          await props.onSave?.();
          setSaved(draft);
        }}
      >
        <label htmlFor="tz-input">Zone</label>
        <input id="tz-input" data-testid="tz-input" value={draft} onChange={(event) => setDraft(event.target.value)} />
      </SettingCard>
    </Box>
  );
}

/**
 * A save that stays pending until the play function presses "release" — so
 * the pending state is observed deterministically, with no timer to race.
 */
function GatedHarness(): React.ReactElement {
  const settle = useRef<(() => void) | null>(null);
  return (
    <>
      <Harness onSave={() => new Promise<void>((resolve) => (settle.current = resolve))} />
      <button type="button" data-testid="release-save" onClick={() => settle.current?.()}>
        release
      </button>
    </>
  );
}

// 1. Interaction

export const OpensInPlace: Story = {
  name: 'Opens in place around the form',
  render: () => <Harness />,
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    await step('Closed card shows the summary and Edit', async () => {
      await expect(canvas.getByTestId('tz-summary')).toHaveTextContent('Europe/Lisbon');
      await expect(canvas.getByTestId('tz-status')).toHaveTextContent('Set');
    });
    await step('Edit opens the form inside the same card', async () => {
      await userEvent.click(canvas.getByTestId('tz-edit'));
      await waitFor(() => expect(canvas.getByTestId('tz')).toHaveAttribute('data-state', 'open'));
      await expect(within(canvas.getByTestId('tz')).getByTestId('tz-input')).toBeVisible();
      await waitFor(() => expect(within(document.body).queryByRole('dialog')).toBeNull());
    });
  },
};

// 2. Focus management

export const FocusRoundTrip: Story = {
  name: 'Focus moves in on open and back to Edit on close',
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId('tz-edit'));
    await waitFor(() => expect(canvas.getByTestId('tz-input')).toHaveFocus());
    await userEvent.click(canvas.getByTestId('tz-cancel'));
    await waitFor(() => expect(canvas.getByTestId('tz-edit')).toHaveFocus());
  },
};

// 3. Keyboard navigation

export const KeyboardOnly: Story = {
  name: 'Keyboard: Enter opens, Escape cancels',
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.tab();
    await waitFor(() => expect(canvas.getByTestId('tz-edit')).toHaveFocus());
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(canvas.getByTestId('tz-input')).toHaveFocus());
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(canvas.getByTestId('tz')).toHaveAttribute('data-state', 'closed'));
    await waitFor(() => expect(canvas.getByTestId('tz-edit')).toHaveFocus());
  },
};

// 4. Async save

export const SaveResolves: Story = {
  name: 'Save: pending state, then closes with the new summary',
  render: () => <GatedHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId('tz-edit'));
    const input = canvas.getByTestId('tz-input');
    await userEvent.clear(input);
    await userEvent.type(input, 'America/Sao_Paulo');
    await userEvent.click(canvas.getByTestId('tz-save'));
    await waitFor(() => expect(canvas.getByTestId('tz-save')).toHaveTextContent(COPY.saving));
    await expect(canvas.getByTestId('tz')).toHaveAttribute('aria-busy', 'true');
    await expect(canvas.getByTestId('tz-saving')).toBeVisible();
    await userEvent.click(canvas.getByTestId('release-save'));
    await waitFor(() => expect(canvas.getByTestId('tz-summary')).toHaveTextContent('America/Sao_Paulo'));
    await waitFor(() => expect(canvas.getByTestId('tz-edit')).toHaveFocus());
  },
};

export const SaveRejects: Story = {
  name: 'Save rejected: stays open with the error and the draft',
  render: () => <Harness onSave={() => Promise.reject(new Error('503'))} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId('tz-edit'));
    await userEvent.type(canvas.getByTestId('tz-input'), '!');
    await userEvent.click(canvas.getByTestId('tz-save'));
    await waitFor(() => expect(canvas.getByTestId('tz-error')).toHaveTextContent(COPY.saveFailed));
    await expect(canvas.getByTestId('tz')).toHaveAttribute('data-state', 'open');
    await expect(canvas.getByTestId('tz-input')).toHaveValue('Europe/Lisbon!');
    await waitFor(() => expect(canvas.getByTestId('tz-save')).toHaveFocus());
  },
};

// 5. Cancel

export const CancelDiscards: Story = {
  name: 'Cancel discards the draft',
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId('tz-edit'));
    await userEvent.type(canvas.getByTestId('tz-input'), 'XYZ');
    await userEvent.click(canvas.getByTestId('tz-cancel'));
    await waitFor(() => expect(canvas.getByTestId('tz-summary')).toHaveTextContent('Europe/Lisbon'));
    await userEvent.click(canvas.getByTestId('tz-edit'));
    await waitFor(() => expect(canvas.getByTestId('tz-input')).toHaveValue('Europe/Lisbon'));
  },
};

// 6. Screen reader

export const AccessibleNames: Story = {
  name: 'Screen reader: region, heading and Edit are named by the title',
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('region', { name: 'Time zone' })).toBeInTheDocument();
    await expect(canvas.getByRole('heading', { level: 3, name: 'Time zone' })).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: `${COPY.edit} Time zone` })).toBeInTheDocument();
  },
};

// 7. Disclosure

export const LearnMoreDisclosure: Story = {
  name: 'Learn more expands and collapses',
  render: () => <Harness defaultOpen />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByTestId('tz-learn-more');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(trigger);
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'true'));
    await waitFor(() => expect(canvas.getByText(/shown in this zone/)).toBeVisible());
    await userEvent.click(trigger);
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'));
  },
};
