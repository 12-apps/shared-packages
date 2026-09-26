import Box from '@mui/material/Box/index.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { CreatableSelect } from './CreatableSelect';
import type { CreatableSelectOption } from './CreatableSelect.types';

const meta: Meta<typeof CreatableSelect> = {
  title: 'Form/CreatableSelect/Tests',
  component: CreatableSelect,
  parameters: {
    layout: 'centered',
    chromatic: { disableSnapshot: false },
  },
  tags: ['autodocs', 'test', 'component:CreatableSelect'],
  args: { createOptionLabel: (input: string) => `Criar "${input}"` },
};

export default meta;
type Story = StoryObj<typeof meta>;

const OPTIONS: CreatableSelectOption[] = [
  { value: 'drinks', label: 'Bebidas' },
  { value: 'food', label: 'Comidas' },
  { value: 'desserts', label: 'Sobremesas' },
];

// ==================== INTERACTION TESTS ====================

export const SelectsAnExistingOption: Story = {
  name: '🧪 Selects an existing option',
  args: {
    options: OPTIONS,
    value: null,
    onChange: fn(),
    label: 'Categoria',
    dataTestId: 'cat',
  },
  play: async ({ canvasElement, args, step }) => {
    const canvas = within(canvasElement);

    await step('Type a query that matches an option and pick it', async () => {
      const input = canvas.getByTestId('cat-input');
      await userEvent.click(input);
      await userEvent.type(input, 'Beb');
      // The options render in a portal, outside canvasElement.
      await waitFor(() => expect(within(document.body).getByText('Bebidas')).toBeInTheDocument());
      await userEvent.click(within(document.body).getByText('Bebidas'));
      await waitFor(() => expect(args.onChange).toHaveBeenCalledWith('drinks'));
    });
  },
};

export const CreatesANewOptionOnEnter: Story = {
  name: '🧪 Creates a new option on Enter',
  args: {
    options: OPTIONS,
    value: null,
    onChange: fn(),
    onCreate: fn(),
    label: 'Categoria',
    dataTestId: 'cat',
  },
  play: async ({ canvasElement, args, step }) => {
    const canvas = within(canvasElement);

    await step('Type an unknown value and press Enter on the create row', async () => {
      const input = canvas.getByTestId('cat-input');
      await userEvent.click(input);
      await userEvent.type(input, 'Lanches');
      // The create row renders in a portal, outside canvasElement.
      await waitFor(() =>
        expect(within(document.body).getByText('Criar "Lanches"')).toBeInTheDocument(),
      );
      await userEvent.keyboard('{ArrowDown}{Enter}');
      await waitFor(() => expect(args.onCreate).toHaveBeenCalledWith('Lanches'));
    });
  },
};

export const NoCreateRowWhenOnCreateOmitted: Story = {
  name: '🧪 No create row without onCreate',
  // Disable auto-action generation for onCreate so it stays falsy when the
  // story omits it (otherwise the global argTypesRegex: '^on[A-Z].*' pattern
  // auto-mocks it, buildFilter sees a truthy onCreate, and the create row this
  // story asserts is absent renders anyway).
  argTypes: {
    onCreate: { action: false },
  },
  args: {
    options: OPTIONS,
    value: null,
    onChange: fn(),
    label: 'Categoria',
    noOptionsText: 'Nada encontrado',
    dataTestId: 'cat',
    // Explicitly set to undefined to override the auto-generated action from
    // argTypesRegex.
    onCreate: undefined,
  },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('An unknown query shows no-options, not a create row', async () => {
      const input = canvas.getByTestId('cat-input');
      await userEvent.click(input);
      await userEvent.type(input, 'Zzz');
      // The no-options and (absent) create-row text render in a portal,
      // outside canvasElement — including the negative below, which was
      // vacuous against canvas since a portalled create row could never be
      // found there, fixed or not.
      await waitFor(() =>
        expect(within(document.body).getByText('Nada encontrado')).toBeInTheDocument(),
      );
      await waitFor(() =>
        expect(within(document.body).queryByText(/^Criar /)).not.toBeInTheDocument(),
      );
    });
  },
};

export const ControlledValueRoundTrips: Story = {
  name: '🧪 Controlled value round-trips',
  render: (args) => {
    const [options, setOptions] = useState<CreatableSelectOption[]>(OPTIONS);
    const [value, setValue] = useState<string | null>(null);
    return (
      <Box sx={{ width: 320 }}>
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
          dataTestId="cat"
        />
      </Box>
    );
  },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('Create a value and confirm it becomes the selected input', async () => {
      const input = canvas.getByTestId('cat-input') as HTMLInputElement;
      await userEvent.click(input);
      await userEvent.type(input, 'Combos');
      // The create row renders in a portal, outside canvasElement.
      await waitFor(() =>
        expect(within(document.body).getByText('Criar "Combos"')).toBeInTheDocument(),
      );
      await userEvent.keyboard('{ArrowDown}{Enter}');
      await waitFor(() => expect(input.value).toBe('Combos'));
    });
  },
};
