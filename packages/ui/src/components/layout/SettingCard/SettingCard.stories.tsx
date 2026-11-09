import Box from '@mui/material/Box/index.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import React, { useState } from 'react';
import { userEvent, within } from 'storybook/test';

import { EN_US_SETTING_CARD_COPY } from '../../../en-US';
import { PT_BR_SETTING_CARD_COPY } from '../../../pt-BR';
import { ThemeProvider, createTheme } from '../../../mui/styles';
import { Icon } from '../../../icons';
import { UploadProgress } from '../../feedback/UploadProgress';
import { useFormBusy, useFormHold } from '../../form/FormHold';
import { Input } from '../../form/Input';
import { NumberField } from '../../form/NumberField';
import { SettingCard } from './SettingCard';
import type { SettingCardProps } from './SettingCard.types';

const meta: Meta<typeof SettingCard> = {
  title: 'Layout/SettingCard',
  component: SettingCard,
  args: {
    copy: EN_US_SETTING_CARD_COPY,
    title: 'Session timeout',
    summary: 'Sign out after 30 minutes without activity',
    status: { label: 'On', color: 'success' },
    learnMore:
      'A shorter timeout protects a shared or unattended device. A longer one is kinder to people who step away mid-task. Signing out never loses a saved draft.',
    onSave: () => new Promise((resolve) => setTimeout(resolve, 800)),
    dataTestId: 'session-timeout',
  },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A setting summarised while closed and edited IN PLACE. Edit opens the card around the host form with a "learn more" disclosure and Cancel / Save. Save may return a promise: the card shows a saving state while it is pending, closes when it resolves, and stays open with the error when it rejects. Focus moves into the card as it opens and back to Edit as it closes. All copy comes in through props.',
      },
    },
  },
  tags: ['autodocs', 'component:SettingCard'],
  argTypes: {
    title: { control: 'text', description: 'The setting name; also the region name' },
    summary: { control: 'text', description: 'The one line a closed card shows' },
    headingLevel: { control: 'select', options: ['h2', 'h3', 'h4', 'h5', 'h6'] },
    disabled: { control: 'boolean', description: 'Disables Edit' },
    saveDisabled: { control: 'boolean', description: 'Disables Save' },
    defaultOpen: { control: 'boolean', description: 'Uncontrolled initial open state' },
  },
  decorators: [
    (Story) => (
      <Box sx={{ maxWidth: 560 }}>
        <Story />
      </Box>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

/** The form a host would pass: controlled, reset on Cancel. */
function TimeoutCard(props: Partial<SettingCardProps>): React.ReactElement {
  const [saved, setSaved] = useState<number | null>(30);
  const [draft, setDraft] = useState<number | null>(30);
  return (
    <SettingCard
      {...(meta.args as SettingCardProps)}
      summary={saved === null ? 'Never sign out' : `Sign out after ${saved} minutes without activity`}
      icon={<Icon name="Info" size="sm" />}
      {...props}
      onCancel={() => setDraft(saved)}
      onSave={async () => {
        await (props.onSave ?? meta.args?.onSave)?.();
        setSaved(draft);
      }}
    >
      <NumberField
        label="Minutes"
        value={draft}
        onChange={setDraft}
        min={5}
        max={240}
        step={5}
        suffix="min"
        helperText="Between 5 and 240"
        data-testid="timeout-minutes"
      />
    </SettingCard>
  );
}

/** Closed: title, status pill, one-line summary, Edit. */
export const Default: Story = {
  render: () => <TimeoutCard />,
};

/** Open in place: the form, the disclosure and the two actions. */
export const Open: Story = {
  render: () => <TimeoutCard defaultOpen />,
};

/** Save pressed and the promise still pending: spinner, "Saving…", the card busy. */
export const Saving: Story = {
  render: () => <TimeoutCard defaultOpen onSave={() => new Promise(() => undefined)} />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('session-timeout-save'));
  },
};

/** The save rejected: the card stays open, the draft is intact, the error is announced. */
export const SaveRejected: Story = {
  render: () => <TimeoutCard defaultOpen onSave={() => Promise.reject(new Error('503'))} />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('session-timeout-save'));
  },
};

/** A host sentence for a known failure, through `formatError`. */
export const HostErrorMessage: Story = {
  render: () => (
    <TimeoutCard
      defaultOpen
      onSave={() => Promise.reject(new Error('conflict'))}
      formatError={() => 'Someone else changed this setting a moment ago. Reload to see their value.'}
    />
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('session-timeout-save'));
  },
};

/** A logo uploading inside the card: it holds the card through `useFormHold`. */
function LogoUploading(): React.ReactElement {
  useFormHold('logo', true);
  // A host field opts in to the hold by reading it.
  const busy = useFormBusy();
  return (
    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, width: (theme) => theme.spacing(21) }}>
        <Box aria-hidden sx={{ bgcolor: 'primary.light', borderRadius: 1.5, aspectRatio: '4 / 3' }} />
        <UploadProgress
          progress={{ stage: 'sending', fraction: 0.48, secondsLeft: 2.6, step: 2, totalSecondsLeft: 2.6 }}
          copy={{
            preparing: 'Ajustando o logo',
            sending: 'Enviando logo',
            saving: 'Logo enviado, salvando…',
            step: (n, of) => `${n} de ${of}`,
            secondsLeft: (n) => `Faltam ~${n} s`,
            totalSecondsLeft: (n) => `Faltam ~${n} s no total`,
            percent: (n) => `${n}%`,
          }}
        />
      </Box>
      <Box sx={{ flex: 1, minWidth: (theme) => theme.spacing(20) }}>
        <Input label="Frase da mesa" placeholder="Peça pelo QR" disabled={busy} data-testid="brand-phrase" />
      </Box>
    </Box>
  );
}

/**
 * Busy while a logo uploads: Save is `aria-disabled` and does nothing, with NO
 * saving spinner (the upload shows its own progress); Cancel stays live and is
 * where the host aborts the upload.
 */
export const BusyWhileUploading: Story = {
  render: () => (
    <SettingCard copy={PT_BR_SETTING_CARD_COPY} title="Marca" defaultOpen onSave={() => undefined} dataTestId="brand">
      <LogoUploading />
    </SettingCard>
  ),
};

/** Edit disabled: the setting is visible but cannot be changed from here. */
export const Disabled: Story = {
  render: () => <TimeoutCard disabled status={{ label: 'Managed by your organisation', color: 'info' }} />,
};

/** No `status`, no `learnMore`, no `icon` — the minimum. */
export const Minimal: Story = {
  render: () => (
    <SettingCard copy={EN_US_SETTING_CARD_COPY} title="Language" summary="English (United States)" onSave={() => undefined}>
      <Box component="p">A language picker goes here.</Box>
    </SettingCard>
  ),
};

/** Long title, long summary: the title wraps, the summary ends in an ellipsis. */
export const LongContent: Story = {
  render: () => (
    <TimeoutCard
      title="Automatically sign out of every device after a period without any activity"
      summary="Sign out after 30 minutes on phones, tablets, desktops and every browser session you have ever opened"
      status={{ label: 'Recommended', color: 'warning' }}
    />
  ),
};

const darkTheme = createTheme({ palette: { mode: 'dark' } });

/** The dark palette: the surface, the open border and the pill read from the theme's roles. */
export const DarkTheme: Story = {
  render: () => (
    <ThemeProvider theme={darkTheme}>
      <Box sx={{ bgcolor: 'background.default', p: 2, display: 'grid', gap: 2 }}>
        <TimeoutCard />
        <TimeoutCard defaultOpen dataTestId="session-timeout-open" />
      </Box>
    </ThemeProvider>
  ),
};
