import Stack from '@mui/material/Stack/index.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';

import { FormContainer } from '../FormContainer';
import { TextField } from './TextField';

const meta: Meta<typeof TextField> = {
  title: 'Form/TotalForm/TextField',
  component: TextField,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The `total-form` text field. `autoComplete` and `inputProps` reach the `<input>` itself, so a form for somebody else\'s data can turn autofill off and pick the phone keypad (FUT-4140).',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

interface SupplierValues extends Record<string, string> {
  name: string;
  phone: string;
  email: string;
  site: string;
}

/**
 * A supplier, typed by the owner: every field is somebody else's data, so none
 * of them takes the browser's autofill, and each asks for its own keypad.
 */
export const ThirdPartyForm: Story = {
  args: { name: 'name' },
  render: function ThirdPartyFormStory() {
    return (
      <FormContainer<SupplierValues>
        initialValues={{ name: '', phone: '', email: '', site: '' }}
        onSubmit={() => undefined}
      >
        <Stack spacing={2} sx={{ maxWidth: 420 }}>
          <TextField name="name" label="Nome" autoComplete="off" />
          <TextField
            name="phone"
            label="Telefone"
            type="tel"
            autoComplete="off"
            inputProps={{ inputMode: 'tel', maxLength: 15 }}
          />
          <TextField
            name="email"
            label="E-mail"
            type="email"
            autoComplete="off"
            inputProps={{ autoCapitalize: 'none', spellCheck: false }}
          />
          <TextField
            name="site"
            label="Site"
            type="url"
            inputProps={{ inputMode: 'url', autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false }}
          />
        </Stack>
      </FormContainer>
    );
  },
};
