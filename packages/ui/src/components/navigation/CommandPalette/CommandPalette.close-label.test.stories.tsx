import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { EN_US_COMMAND_PALETTE_COPY } from '../../../en-US';
import { PT_BR_COMMAND_PALETTE_COPY } from '../../../pt-BR';

import { CommandPalette } from './CommandPalette';

/**
 * THE SEARCH ROW'S ✕ HAS A NAME (FUT-4162).
 *
 * It was an icon-only button with no `aria-label`, so a screen reader said
 * "button" and nothing else. It now reads the pack's `closeSearch`, with the
 * English word for a host pack written before the key existed.
 */
const meta: Meta<typeof CommandPalette> = {
  title: 'Navigation/CommandPalette/Close label/Tests',
  component: CommandPalette,
  args: { open: true, commands: [], copy: PT_BR_COMMAND_PALETTE_COPY },
  parameters: { layout: 'centered' },
  tags: ['test', 'component:CommandPalette'],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const NamedByThePack: Story = {
  args: { onClose: fn() },
  play: async ({ args }) => {
    const close = await within(document.body).findByRole('button', {
      name: PT_BR_COMMAND_PALETTE_COPY.closeSearch,
    });
    await userEvent.click(close);
    await expect(args.onClose).toHaveBeenCalledTimes(1);
  },
};

export const FallsBackToEnglish: Story = {
  args: {
    onClose: fn(),
    copy: { ...PT_BR_COMMAND_PALETTE_COPY, closeSearch: undefined },
  },
  play: async () => {
    await expect(
      await within(document.body).findByRole('button', { name: EN_US_COMMAND_PALETTE_COPY.closeSearch }),
    ).toBeInTheDocument();
  },
};
