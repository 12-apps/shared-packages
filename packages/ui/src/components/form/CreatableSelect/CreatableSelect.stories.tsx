import { Box } from '@mui/material';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { CreatableSelect } from './CreatableSelect';
import type { CreatableSelectOption } from './CreatableSelect.types';

const meta: Meta<typeof CreatableSelect> = {
  title: 'Form/CreatableSelect',
  component: CreatableSelect,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'A single-select, searchable combobox that can create a new option inline (create-on-Enter).',
      },
    },
  },
  tags: ['autodocs', 'component:CreatableSelect'],
  argTypes: {
    label: { control: 'text' },
    placeholder: { control: 'text' },
    disabled: { control: 'boolean' },
    loading: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

const BASE_OPTIONS: CreatableSelectOption[] = [
  { value: 'drinks', label: 'Bebidas' },
  { value: 'food', label: 'Comidas' },
  { value: 'desserts', label: 'Sobremesas' },
];

/** Plain searchable select — no `onCreate`, so typing an unknown value offers no create row. */
export const SearchableSelect: Story = {
  render: (args) => {
    const [value, setValue] = useState<string | null>(null);
    return (
      <Box sx={{ width: 360 }}>
        <CreatableSelect {...args} options={BASE_OPTIONS} value={value} onChange={setValue} />
      </Box>
    );
  },
  args: { label: 'Categoria', placeholder: 'Selecione…' },
};

/** Pick-or-create: an unknown query shows a "Criar …" row; choosing it appends + selects it. */
export const Creatable: Story = {
  render: (args) => {
    const [options, setOptions] = useState<CreatableSelectOption[]>(BASE_OPTIONS);
    const [value, setValue] = useState<string | null>(null);
    return (
      <Box sx={{ width: 360 }}>
        <CreatableSelect
          {...args}
          options={options}
          value={value}
          onChange={setValue}
          onCreate={(label) => {
            const created = { value: label.toLowerCase(), label };
            setOptions((prev) => [...prev, created]);
            setValue(created.value);
          }}
        />
      </Box>
    );
  },
  args: { label: 'Categoria', placeholder: 'Buscar ou criar…' },
};

/** Preselected value. */
export const WithValue: Story = {
  render: (args) => {
    const [value, setValue] = useState<string | null>('food');
    return (
      <Box sx={{ width: 360 }}>
        <CreatableSelect {...args} options={BASE_OPTIONS} value={value} onChange={setValue} />
      </Box>
    );
  },
  args: { label: 'Categoria' },
};

/** Loading state (e.g. while a create request is in flight). */
export const Loading: Story = {
  render: (args) => {
    const [value, setValue] = useState<string | null>(null);
    return (
      <Box sx={{ width: 360 }}>
        <CreatableSelect {...args} options={BASE_OPTIONS} value={value} onChange={setValue} />
      </Box>
    );
  },
  args: { label: 'Categoria', loading: true },
};

/** Disabled state. */
export const Disabled: Story = {
  render: (args) => {
    const [value, setValue] = useState<string | null>('drinks');
    return (
      <Box sx={{ width: 360 }}>
        <CreatableSelect {...args} options={BASE_OPTIONS} value={value} onChange={setValue} />
      </Box>
    );
  },
  args: { label: 'Categoria', disabled: true },
};
