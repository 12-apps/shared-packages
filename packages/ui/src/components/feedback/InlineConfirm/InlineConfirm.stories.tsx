import type { Meta, StoryObj } from '@storybook/react-vite';
import Paper from '@mui/material/Paper/index.js';
import Stack from '@mui/material/Stack/index.js';
import Typography from '@mui/material/Typography/index.js';
import React, { useState } from 'react';

import { Button } from '../../form/Button';

import { InlineConfirm } from './InlineConfirm';
import type { InlineConfirmProps } from './InlineConfirm.types';

/** The words a host passes; the component writes none. pt-BR, as a host would. */
const WORDS = {
  title: 'Remover Joaquim da fila?',
  description: 'Sai do 2º lugar e quem está atrás sobe.',
  irreversibleNote: 'Não dá para desfazer.',
  confirmText: 'Remover da fila',
  cancelText: 'Manter',
  errorText: 'Não foi possível remover.',
};

/** A list row with its trigger, the place the confirmation opens. */
function Row(props: Partial<InlineConfirmProps> & { width?: number }): React.JSX.Element {
  const [open, setOpen] = useState(props.open ?? false);
  return (
    <Paper variant="outlined" sx={{ p: 2, width: props.width ?? 520 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography variant="body1" sx={{ fontWeight: 600 }}>
          2. Joaquim Prado
        </Typography>
        {open ? null : (
          <Button variant="text" color="neutral" size="sm" onClick={() => setOpen(true)}>
            Remover da fila
          </Button>
        )}
      </Stack>
      <InlineConfirm
        {...WORDS}
        {...props}
        open={open}
        onConfirm={props.onConfirm ?? (() => setOpen(false))}
        onCancel={() => setOpen(false)}
      />
    </Paper>
  );
}

const meta: Meta<typeof Row> = {
  title: 'Feedback/InlineConfirm',
  component: Row,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'The confirmation of an irreversible act, drawn in place inside the list row it acts on: the act as a question, what happens, what cannot be undone set apart, the verb as the one red button and a way out. ConfirmAction\'s contract without the popup.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: {} };

export const Open: Story = { args: { open: true } };

export const OnAPhone: Story = { args: { open: true, width: 300 } };

export const Failed: Story = {
  args: { open: true, onConfirm: () => Promise.reject(new Error('Esse cliente já saiu da fila.')) },
};

export const Pending: Story = {
  args: { open: true, onConfirm: () => new Promise<void>(() => undefined) },
};
