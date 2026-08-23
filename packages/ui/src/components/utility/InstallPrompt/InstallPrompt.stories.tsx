import { Box, Typography } from '@mui/material';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect } from 'react';

import { InstallPrompt } from './InstallPrompt';
import type { BeforeInstallPromptEvent } from './InstallPrompt.types';
import { PT_BR_INSTALL_PROMPT_COPY } from '../../../pt-BR';

/**
 * The component listens for a browser event that Storybook will never fire, so
 * every story synthesises one. This is also the shape a host can dispatch from
 * its own early capture script to replay an event that arrived before React
 * mounted.
 */
const useSyntheticInstallEvent = () => {
  useEffect(() => {
    const event = new Event('beforeinstallprompt') as BeforeInstallPromptEvent;

    Object.assign(event, {
      platforms: ['web'],
      prompt: () => Promise.resolve(),
      userChoice: Promise.resolve({ outcome: 'accepted' as const, platform: 'web' }),
    });

    window.dispatchEvent(event);
  }, []);
};

/** Storage is shared across stories; clear it so a dismissal in one does not hide the next. */
const useCleanDismissalState = (storageKey: string) => {
  useEffect(() => {
    window.localStorage.removeItem(storageKey);
  }, [storageKey]);
};

const meta: Meta<typeof InstallPrompt> = {
  args: { copy: PT_BR_INSTALL_PROMPT_COPY },
  title: 'Utility/InstallPrompt',
  component: InstallPrompt,
  tags: ['autodocs', 'component:InstallPrompt'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Dismissible PWA install invitation. Captures the Chromium `beforeinstallprompt` ' +
          'event so the app can offer installation itself, and falls back to Add to Home ' +
          'Screen instructions on iOS Safari, where no programmatic install exists. Renders ' +
          'nothing when the app is already installed, was recently dismissed, or the browser ' +
          'cannot install it.',
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof InstallPrompt>;

const DefaultComponent = () => {
  useCleanDismissalState('sb-install-default');
  useSyntheticInstallEvent();

  return <InstallPrompt copy={PT_BR_INSTALL_PROMPT_COPY} storageKey="sb-install-default" />;
};

export const Default: Story = {
  render: () => <DefaultComponent />,
};

const WithDescriptionComponent = () => {
  useCleanDismissalState('sb-install-described');
  useSyntheticInstallEvent();

  return (
    <InstallPrompt copy={PT_BR_INSTALL_PROMPT_COPY}
      storageKey="sb-install-described"
      title="Install FutureDrink"
      description="Order faster next time — the menu opens straight from your home screen."
      installLabel="Install"
    />
  );
};

export const WithDescription: Story = {
  render: () => <WithDescriptionComponent />,
};

const LocalisedComponent = () => {
  useCleanDismissalState('sb-install-ptbr');
  useSyntheticInstallEvent();

  return (
    <InstallPrompt copy={PT_BR_INSTALL_PROMPT_COPY}
      storageKey="sb-install-ptbr"
      title="Instalar o FutureDrink"
      description="Peça mais rápido na próxima visita, direto da tela de início."
      installLabel="Instalar"
      dismissLabel="Dispensar"
    />
  );
};

/** Every string is a prop; this package ships no locale of its own. */
export const Localised: Story = {
  render: () => <LocalisedComponent />,
};

const NotInstallableComponent = () => (
  <Box>
    <Typography variant="body2" sx={{ mb: 2 }}>
      No install event was dispatched, so the component renders nothing. This is what a browser
      with no install route, an already-installed app, and a recent dismissal all look like.
    </Typography>
    <InstallPrompt copy={PT_BR_INSTALL_PROMPT_COPY} storageKey="sb-install-absent" />
  </Box>
);

export const NotInstallable: Story = {
  render: () => <NotInstallableComponent />,
};
