import Box from '@mui/material/Box/index.js';
import Typography from '@mui/material/Typography/index.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';

import { Button } from '../../form/Button';
import { UploadProgress } from './UploadProgress';
import { useUploadTimeLeft } from './UploadProgress.hooks';
import type { UploadProgressCopy, UploadProgressValue } from './UploadProgress.types';

/**
 * Example HOST copy (pt-BR, as a Brazilian storefront would pass it). The
 * component ships no words of its own.
 */
const COPY: UploadProgressCopy = {
  preparing: 'Ajustando a foto',
  sending: 'Enviando foto',
  saving: 'Foto enviada, salvando…',
  step: (n, of) => `${n} de ${of}`,
  secondsLeft: (n) => `Faltam ~${n} s`,
  totalSecondsLeft: (n) => `Faltam ~${n} s no total`,
  percent: (n) => `${n}%`,
};

const PREPARING: UploadProgressValue = { stage: 'preparing', fraction: 0.25, secondsLeft: 2.3, step: 1, totalSecondsLeft: 6.2 };
const SENDING: UploadProgressValue = { stage: 'sending', fraction: 0.62, secondsLeft: 4.4, step: 2, totalSecondsLeft: 4.4 };
const SAVING: UploadProgressValue = { stage: 'saving', fraction: null, secondsLeft: null, step: 3, totalSecondsLeft: null };

/** The photo the progress sits under: a stand-in in the theme's own colour. */
function Photo({ size }: { size: 'regular' | 'thumb' }): React.ReactElement {
  return (
    <Box
      aria-hidden
      sx={{
        bgcolor: 'primary.light',
        borderRadius: 1.5,
        width: size === 'thumb' ? (theme) => theme.spacing(5.5) : '100%',
        aspectRatio: size === 'thumb' ? '1' : '4 / 3',
      }}
    />
  );
}

const meta: Meta<typeof UploadProgress> = {
  title: 'Feedback/UploadProgress',
  component: UploadProgress,
  args: { copy: COPY, progress: SENDING, size: 'regular', dataTestId: 'upload-progress' },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Where a photo is while it goes up: the stage word, a bar and the time left, in three stages (re-encode, bytes, server). `saving` has no honest estimate, so it is a spinner and the word. The stage word is the only text in the live region, so a screen reader hears each stage once and never every percent. Every word comes from the caller.',
      },
    },
  },
  tags: ['autodocs', 'component:UploadProgress'],
  argTypes: {
    size: { control: 'inline-radio', options: ['regular', 'compact'] },
  },
  decorators: [
    (Story) => (
      <Box sx={{ maxWidth: (theme) => theme.spacing(32) }}>
        <Story />
      </Box>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

/** Re-encoding: the step and, with a known sending rate, the total time. */
export const PreparingWithStepAndTotal: Story = {
  args: { progress: PREPARING },
  render: (args) => (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Photo size="regular" />
      <UploadProgress {...args} />
    </Box>
  ),
};

/** Re-encoding with no sending rate known yet: only the stage's own time. */
export const PreparingStageTimeOnly: Story = {
  args: { progress: { ...PREPARING, totalSecondsLeft: null } },
};

/** Sending: the percentage and the time left. */
export const Sending: Story = {
  args: { progress: SENDING },
  render: (args) => (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Photo size="regular" />
      <UploadProgress {...args} />
    </Box>
  ),
};

/** Sending before the first measuring window: the bar, no time yet. */
export const SendingNotYetMeasured: Story = {
  args: { progress: { ...SENDING, fraction: 0.04, secondsLeft: null, totalSecondsLeft: null } },
};

/** A transport that reports no bytes: no estimate, so the spinner stands in. */
export const SendingWithoutEstimate: Story = {
  args: { progress: { ...SENDING, fraction: null, secondsLeft: null, totalSecondsLeft: null } },
};

/** The server cutting its crops: a spinner and the word, no number. */
export const Saving: Story = {
  args: { progress: SAVING },
  render: (args) => (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Photo size="regular" />
      <UploadProgress {...args} />
    </Box>
  ),
};

/** A row with a 44 px variation thumbnail: the bar under it, the time at the row's end. */
function VariationRow({ progress }: { progress: UploadProgressValue }): React.ReactElement {
  const time = useUploadTimeLeft(progress);
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        p: 1.5,
        border: 1,
        borderColor: 'divider',
        borderRadius: 1.5,
      }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, width: (theme) => theme.spacing(5.5), flexShrink: 0 }}>
        <Photo size="thumb" />
        <UploadProgress progress={progress} copy={COPY} size="compact" dataTestId="variation-progress" />
      </Box>
      <Typography sx={{ flex: 1, minWidth: 0 }}>1kg</Typography>
      <Typography>R$ 16,00</Typography>
      {time && (
        <Typography variant="caption" color="text.secondary" data-testid="variation-time">
          ~{time.seconds} s
        </Typography>
      )}
    </Box>
  );
}

export const Compact: Story = {
  render: () => <VariationRow progress={{ ...SENDING, fraction: 0.4, secondsLeft: 5.2 }} />,
  decorators: [
    (Story) => (
      <Box sx={{ maxWidth: (theme) => theme.spacing(60) }}>
        <Story />
      </Box>
    ),
  ],
};

export const CompactSaving: Story = {
  render: () => <VariationRow progress={SAVING} />,
};

/**
 * The failure frame: the progress is gone (`progress: null` renders nothing),
 * the previous photo is back and the host states the reason with a retry —
 * composed from existing pieces, not drawn by this component.
 */
export const Failure: Story = {
  args: { progress: null },
  render: (args) => (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'flex-start' }}>
      <Box
        sx={{
          width: (theme) => theme.spacing(20),
          aspectRatio: '1',
          flexShrink: 0,
          border: 1,
          borderStyle: 'dashed',
          borderColor: 'divider',
          borderRadius: 1.5,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Typography variant="body2">Enviar foto</Typography>
      </Box>
      <UploadProgress {...args} />
      <Box
        role="alert"
        sx={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'flex-start', flex: 1, minWidth: (theme) => theme.spacing(25) }}
      >
        <Typography variant="body2" color="error" sx={{ fontWeight: 600 }}>
          Não deu para enviar a foto
        </Typography>
        <Typography variant="body2" color="text.secondary">
          A conexão caiu no meio do envio. Tente de novo.
        </Typography>
        <Button variant="outline" color="neutral" size="sm">
          Tentar de novo
        </Button>
      </Box>
    </Box>
  ),
  decorators: [
    (Story) => (
      <Box sx={{ maxWidth: (theme) => theme.spacing(64) }}>
        <Story />
      </Box>
    ),
  ],
};
