import type { Meta, StoryObj } from '@storybook/react-vite';
import React, { useRef, useState } from 'react';
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
  name: '🧪 Under 288px: each button spans its own line, the verb on top',
  args: { ...WORDS, onConfirm: fn(), onCancel: fn() },
  render: (args) => (
    <div style={{ width: 260 }}>
      <InlineConfirm {...args} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const root = canvas.getByTestId('inline-confirm').getBoundingClientRect();
    const verb = canvas.getByTestId('inline-confirm-confirm').getBoundingClientRect();
    const keep = canvas.getByTestId('inline-confirm-cancel').getBoundingClientRect();
    await expect(verb.bottom).toBeLessThanOrEqual(keep.top + 1);
    await expect(Math.abs(verb.width - root.width)).toBeLessThan(2);
    await expect(Math.abs(keep.width - root.width)).toBeLessThan(2);
  },
};

/** The documented shape: the trigger hides while asking and comes back through `returnFocusTo`. */
function HidingTrigger({ onCancel }: { onCancel: () => void }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  return (
    <div style={{ width: 520 }}>
      {open ? null : (
        <button ref={trigger} type="button" onClick={() => setOpen(true)}>
          Remover da fila
        </button>
      )}
      <InlineConfirm
        {...WORDS}
        open={open}
        onConfirm={fn()}
        onCancel={() => {
          onCancel();
          setOpen(false);
        }}
        returnFocusTo={() => trigger.current}
      />
    </div>
  );
}

export const FocusComesBackToAHiddenTrigger: Story = {
  name: '🧪 A trigger hidden while asking gets focus back, after Manter and after Escape',
  args: { ...WORDS, onConfirm: fn(), onCancel: fn() },
  render: (args) => <HidingTrigger onCancel={args.onCancel} />,
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Remover da fila' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Manter' }));
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Remover da fila' })).toHaveFocus());
    await userEvent.click(canvas.getByRole('button', { name: 'Remover da fila' }));
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Manter' })).toHaveFocus());
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Remover da fila' })).toHaveFocus());
    await expect(args.onCancel).toHaveBeenCalledTimes(2);
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
