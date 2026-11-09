import Box from '@mui/material/Box/index.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';

import { UploadProgress } from '../../feedback/UploadProgress';
import type { UploadProgressCopy, UploadProgressValue } from '../../feedback/UploadProgress';
import { Button } from '../Button';
import { useFormHold } from '../FormHold';
import { FormContainer } from './FormContainer';
import { SubmitButton } from './SubmitButton';
import { TextField } from './Fields';

/** Example HOST copy (pt-BR). The components ship no words of their own. */
const COPY: UploadProgressCopy = {
  preparing: 'Ajustando a foto',
  sending: 'Enviando foto',
  saving: 'Foto enviada, salvando…',
  step: (n, of) => `${n} de ${of}`,
  secondsLeft: (n) => `Faltam ~${n} s`,
  totalSecondsLeft: (n) => `Faltam ~${n} s no total`,
  percent: (n) => `${n}%`,
};

const SENDING: UploadProgressValue = { stage: 'sending', fraction: 0.62, secondsLeft: 4.4, step: 2, totalSecondsLeft: 4.4 };

const meta: Meta<typeof SubmitButton> = {
  title: 'Form/TotalForm/Hold',
  component: SubmitButton,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A form held while a photo uploads. A field registers its upload with `useFormHold(key, uploading)`; the `total-form` fields and every submit read `useFormBusy()` and wait, and `FormContainer` refuses a held submit, `requestSubmit()` included. A plain `Button` is not held, so navigation stays live. `progress` on `Button` / `SubmitButton` turns the button into the bar: it fills behind the label, stays focusable and `aria-disabled`, and a press does nothing.',
      },
    },
  },
  tags: ['autodocs', 'component:SubmitButton'],
  decorators: [
    (Story) => (
      <Box sx={{ maxWidth: (theme) => theme.spacing(70) }}>
        <Story />
      </Box>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

/** `SubmitButton` filling at 62 %, its label saying what it waits for. */
export const SubmitButtonWithProgress: Story = {
  render: () => (
    <FormContainer initialValues={{}} onSubmit={() => undefined} dataTestId="hold-form">
      <SubmitButton progress={{ fraction: 0.62, label: 'Enviando foto · ~5 s' }}>Salvar</SubmitButton>
    </FormContainer>
  ),
};

/** No fraction to fill with (the server is saving): a spinner and the label. */
export const SubmitButtonSaving: Story = {
  render: () => (
    <FormContainer initialValues={{}} onSubmit={() => undefined} dataTestId="hold-form">
      <SubmitButton progress={{ fraction: null, label: 'Salvando foto…' }}>Salvar</SubmitButton>
    </FormContainer>
  ),
};

/** A plain `type="button"` publish button, which must stay one, as the bar. */
export const ButtonWithProgress: Story = {
  render: () => (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start' }}>
      <Button dataTestId="publish-25" progress={{ fraction: 0.25, label: 'Ajustando a foto · ~7 s' }}>
        Publicar
      </Button>
      <Button dataTestId="publish-62" progress={{ fraction: 0.62, label: 'Enviando foto · ~5 s' }}>
        Publicar
      </Button>
      <Button dataTestId="publish-saving" progress={{ fraction: null, label: 'Salvando foto…' }}>
        Publicar
      </Button>
      <Button dataTestId="publish-idle">Publicar</Button>
    </Box>
  ),
};

/** The photo field: it holds the form while `progress` is set. */
function PhotoField({ progress }: { progress: UploadProgressValue | null }): React.ReactElement {
  useFormHold('photo', progress !== null);
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, width: (theme) => theme.spacing(24), flexShrink: 0 }}>
      <Box aria-hidden sx={{ bgcolor: 'primary.light', borderRadius: 1.5, aspectRatio: '4 / 3' }} />
      <UploadProgress progress={progress} copy={COPY} />
    </Box>
  );
}

/**
 * The product frame: the photo shows A, the fields and Salvar are held,
 * Publicar is C, and Voltar — a plain `Button` — stays live.
 */
export const FormHeldWhileUploading: Story = {
  render: () => (
    <FormContainer initialValues={{ name: 'Sabão em Pó', description: '1kg' }} onSubmit={() => undefined} dataTestId="product-form">
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, mb: 2 }}>
        <Button variant="outline" color="neutral" dataTestId="back">
          Voltar
        </Button>
        <Button dataTestId="publish" progress={{ fraction: SENDING.fraction, label: 'Enviando foto · ~5 s' }}>
          Publicar
        </Button>
      </Box>
      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <PhotoField progress={SENDING} />
        <Box sx={{ flex: 1, minWidth: (theme) => theme.spacing(28), display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField name="name" label="Nome do produto" />
          <TextField name="description" label="Descrição" />
          <Box>
            <SubmitButton>Salvar</SubmitButton>
          </Box>
        </Box>
      </Box>
    </FormContainer>
  ),
};
