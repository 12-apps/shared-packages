import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { InlineConfirm } from './InlineConfirm';

const meta: Meta<typeof InlineConfirm> = {
  title: 'Feedback/InlineConfirm/Tests',
  component: InlineConfirm,
  parameters: { layout: 'centered', chromatic: { disableSnapshot: false } },
  tags: ['autodocs', 'test', 'component:InlineConfirm'],
};

export default meta;
type Story = StoryObj<typeof meta>;

const WORDS = {
  open: true,
  title: 'Remover Joaquim da fila?',
  description: 'Sai do 2º lugar e quem está atrás sobe.',
  irreversibleNote: 'Não dá para desfazer.',
  confirmText: 'Remover da fila',
  cancelText: 'Manter',
};

export const LaysTheVerbFirst: Story = {
  name: '🧪 The verb leads at the start edge, the cancel after it, side by side',
  args: { ...WORDS, onConfirm: fn(), onCancel: fn() },
  render: (args) => (
    <div style={{ width: 520 }}>
      <InlineConfirm {...args} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const verb = canvas.getByTestId('inline-confirm-confirm').getBoundingClientRect();
    const keep = canvas.getByTestId('inline-confirm-cancel').getBoundingClientRect();
    await expect(verb.left).toBeLessThan(keep.left);
    await expect(Math.abs(verb.top - keep.top)).toBeLessThan(2);
  },
};

export const StacksVerbOnTopWhenNarrow: Story = {
  name: '🧪 Narrow: whole buttons stack, the verb on top',
  args: { ...WORDS, onConfirm: fn(), onCancel: fn() },
  render: (args) => (
    <div style={{ width: 220 }}>
      <InlineConfirm {...args} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const verb = canvas.getByTestId('inline-confirm-confirm').getBoundingClientRect();
    const keep = canvas.getByTestId('inline-confirm-cancel').getBoundingClientRect();
    await expect(verb.bottom).toBeLessThanOrEqual(keep.top + 1);
  },
};

export const EscapeCancels: Story = {
  name: '🧪 Escape backs out',
  args: { ...WORDS, onConfirm: fn(), onCancel: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByTestId('inline-confirm-cancel')).toHaveFocus());
    await userEvent.keyboard('{Escape}');
    await expect(args.onCancel).toHaveBeenCalledTimes(1);
    await expect(args.onConfirm).not.toHaveBeenCalled();
  },
};
