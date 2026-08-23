import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { InstallPrompt } from './InstallPrompt';
import type { BeforeInstallPromptEvent } from './InstallPrompt.types';
import { PT_BR_INSTALL_PROMPT_COPY } from '../../../pt-BR';

const meta: Meta<typeof InstallPrompt> = {
  args: { copy: PT_BR_INSTALL_PROMPT_COPY },
  title: 'Utility/InstallPrompt/Tests',
  component: InstallPrompt,
  parameters: {
    layout: 'padded',
    chromatic: { disableSnapshot: false },
  },
  tags: ['autodocs', 'test', 'component:InstallPrompt'],
};

export default meta;
export type Story = StoryObj<typeof meta>;

const dispatchInstallEvent = () => {
  const event = new Event('beforeinstallprompt') as BeforeInstallPromptEvent;

  Object.assign(event, {
    platforms: ['web'],
    prompt: () => Promise.resolve(),
    userChoice: Promise.resolve({ outcome: 'accepted' as const, platform: 'web' }),
  });

  window.dispatchEvent(event);
};

const Installable = ({ storageKey }: { storageKey: string }) => {
  useEffect(() => {
    window.localStorage.removeItem(storageKey);
    dispatchInstallEvent();
  }, [storageKey]);

  return <InstallPrompt copy={PT_BR_INSTALL_PROMPT_COPY} storageKey={storageKey} title="Install this app" />;
};

// ================================
// INTERACTION TESTS
// ================================

export const AppearsWhenInstallable: Story = {
  render: () => <Installable storageKey="sb-test-appears" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(async () => {
      await expect(canvas.getByTestId('install-prompt')).toBeInTheDocument();
    });
    await expect(canvas.getByTestId('install-prompt-install')).toBeInTheDocument();
  },
};

export const DismissHidesPrompt: Story = {
  render: () => <Installable storageKey="sb-test-dismiss" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(async () => {
      await expect(canvas.getByTestId('install-prompt-dismiss')).toBeInTheDocument();
    });
    await userEvent.click(canvas.getByTestId('install-prompt-dismiss'));

    await waitFor(async () => {
      await expect(canvas.queryByTestId('install-prompt')).not.toBeInTheDocument();
    });
  },
};

export const HiddenWithoutInstallEvent: Story = {
  render: () => <InstallPrompt copy={PT_BR_INSTALL_PROMPT_COPY} storageKey="sb-test-hidden" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(async () => {
      await expect(canvas.queryByTestId('install-prompt')).not.toBeInTheDocument();
    });
  },
};
