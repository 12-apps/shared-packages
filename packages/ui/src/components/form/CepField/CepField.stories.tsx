import Paper from '@mui/material/Paper/index.js';
import Stack from '@mui/material/Stack/index.js';
import Typography from '@mui/material/Typography/index.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import React, { useState } from 'react';

import { CepField } from './CepField';
import type { CepAddress } from './CepField.types';
import { PT_BR_CEP_FIELD_COPY } from '../../../pt-BR';

const meta: Meta<typeof CepField> = {
  args: { copy: PT_BR_CEP_FIELD_COPY },
  title: 'Form/CepField',
  component: CepField,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A CEP input that fills the rest of the address in. Masks to `#####-###`, waits for a complete CEP, then calls the injected `onLookup` and hands the result to `onResolved`. The lookup is injected, so the component works with any backend — or none.',
      },
    },
  },
  tags: ['autodocs', 'component:CepField'],
  argTypes: {
    value: { control: 'text', description: 'Current value (masked or bare)' },
    label: { control: 'text', description: 'Visible label' },
    placeholder: { control: 'text', description: 'Placeholder text' },
    error: { control: 'text', description: 'Validation error from the caller' },
    disabled: { control: 'boolean', description: 'Disable input and lookups' },
    debounceMs: { control: 'number', description: 'Delay before looking up' },
    name: { control: 'text', description: 'Field name / input id' },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

/** Stand-in for a real provider — resolves one CEP, rejects everything else. */
const FIXTURES: Record<string, CepAddress> = {
  '01310100': {
    cep: '01310100',
    street: 'Avenida Paulista',
    neighborhood: 'Bela Vista',
    city: 'São Paulo',
    state: 'SP',
  },
  '20040020': {
    cep: '20040020',
    street: 'Avenida Rio Branco',
    neighborhood: 'Centro',
    city: 'Rio de Janeiro',
    state: 'RJ',
  },
};

const fakeLookup = async (cep: string): Promise<CepAddress | null> => {
  await new Promise((resolve) => setTimeout(resolve, 400));
  return FIXTURES[cep] ?? null;
};

/** The whole point: type a CEP, watch the address fields fill themselves. */
function Demo({
  lookup = fakeLookup,
  ...props
}: {
  lookup?: (cep: string) => Promise<CepAddress | null>;
  label?: string;
  disabled?: boolean;
}): React.ReactElement {
  const [cep, setCep] = useState('');
  const [address, setAddress] = useState<CepAddress | null>(null);

  return (
    <Stack spacing={2} sx={{ maxWidth: 420 }}>
      <CepField copy={PT_BR_CEP_FIELD_COPY}
        {...props}
        value={cep}
        onChange={setCep}
        onLookup={lookup}
        onResolved={setAddress}
      />
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="caption" color="text.secondary">
          Endereço resolvido
        </Typography>
        <Typography variant="body2">{address?.street ?? '—'}</Typography>
        <Typography variant="body2">{address?.neighborhood ?? '—'}</Typography>
        <Typography variant="body2">
          {address ? `${address.city ?? '—'} / ${address.state ?? '—'}` : '—'}
        </Typography>
      </Paper>
      <Typography variant="caption" color="text.secondary">
        Try 01310-100 or 20040-020. Anything else resolves to “não encontrado”.
      </Typography>
    </Stack>
  );
}

export const Default: Story = {
  render: () => <Demo />,
};

export const CustomLabel: Story = {
  render: () => <Demo label="CEP do fornecedor" />,
};

export const Disabled: Story = {
  render: () => <Demo disabled />,
};

/** Every provider is down. The field degrades to a plain masked input. */
export const LookupUnavailable: Story = {
  render: () => <Demo lookup={async () => null} />,
};

/** No `onLookup` at all — just the mask and validation. */
export const MaskOnly: Story = {
  render: function MaskOnlyStory() {
    const [cep, setCep] = useState('');
    return (
      <Stack sx={{ maxWidth: 420 }}>
        <CepField copy={PT_BR_CEP_FIELD_COPY} value={cep} onChange={setCep} />
      </Stack>
    );
  },
};

export const WithError: Story = {
  render: function WithErrorStory() {
    const [cep, setCep] = useState('123');
    return (
      <Stack sx={{ maxWidth: 420 }}>
        <CepField copy={PT_BR_CEP_FIELD_COPY}
          value={cep}
          onChange={setCep}
          error="CEP inválido — use o formato 00000-000."
        />
      </Stack>
    );
  },
};
