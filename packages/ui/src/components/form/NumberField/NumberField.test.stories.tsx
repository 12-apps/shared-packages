import Stack from '@mui/material/Stack/index.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import React, { useState } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { NumberField } from './NumberField';
import type { NumberFieldProps } from './NumberField.types';

const meta: Meta<typeof NumberField> = {
  title: 'Form/NumberField/Tests',
  component: NumberField,
  args: { label: 'Timeout', value: null, onChange: () => undefined },
  parameters: {
    layout: 'centered',
    chromatic: { disableSnapshot: false },
    docs: { description: { component: 'Interaction tests for NumberField: digits only, arrows, null when empty.' } },
  },
  tags: ['autodocs', 'test', 'component:NumberField'],
};

export default meta;
export type Story = StoryObj<typeof meta>;

function Harness({ initial = null, ...props }: Partial<NumberFieldProps> & { initial?: number | null }): React.ReactElement {
  const [value, setValue] = useState<number | null>(initial);
  return (
    <Stack spacing={1} sx={{ width: 260 }}>
      <NumberField label="Timeout" data-testid="n" {...props} value={value} onChange={setValue} />
      <output data-testid="reported">{value === null ? 'null' : String(value)}</output>
    </Stack>
  );
}

export const TypingKeepsDigitsOnly: Story = {
  name: 'Typing: letters and signs never land',
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByTestId('n'), '1a2-3.e');
    await waitFor(() => expect(canvas.getByTestId('n')).toHaveValue('123'));
    await expect(canvas.getByTestId('reported')).toHaveTextContent('123');
  },
};

export const PasteKeepsDigitsOnly: Story = {
  name: 'Paste: keeps only the digits',
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId('n'));
    await userEvent.paste('1.500 min');
    await waitFor(() => expect(canvas.getByTestId('reported')).toHaveTextContent('1500'));
  },
};

export const ArrowsStepWithinBounds: Story = {
  name: 'ArrowUp / ArrowDown step and stop at the bounds',
  render: () => <Harness initial={10} min={5} max={20} step={5} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId('n'));
    await userEvent.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}');
    await waitFor(() => expect(canvas.getByTestId('reported')).toHaveTextContent('20'));
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}');
    await waitFor(() => expect(canvas.getByTestId('reported')).toHaveTextContent('5'));
    await expect(canvas.getByRole('spinbutton')).toHaveAttribute('aria-valuenow', '5');
  },
};

export const ClearingReportsNull: Story = {
  name: 'Clearing reports null, not 0',
  render: () => <Harness initial={42} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.clear(canvas.getByTestId('n'));
    await waitFor(() => expect(canvas.getByTestId('reported')).toHaveTextContent('null'));
    await expect(canvas.getByTestId('n')).toHaveValue('');
  },
};

export const BlurClampsTypedValue: Story = {
  name: 'Blur brings a typed value back inside the bounds',
  render: () => <Harness min={10} max={60} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByTestId('n'), '5');
    await waitFor(() => expect(canvas.getByTestId('reported')).toHaveTextContent('5'));
    await userEvent.tab();
    await waitFor(() => expect(canvas.getByTestId('reported')).toHaveTextContent('10'));
  },
};

export const SuffixInsideTheBorder: Story = {
  name: 'The suffix is drawn inside the field',
  render: () => <Harness initial={15} suffix="min" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByTestId('n');
    const suffix = canvas.getByText('min');
    const field = input.closest('.MuiInputBase-root') as HTMLElement;
    const box = field.getBoundingClientRect();
    const unit = suffix.getBoundingClientRect();
    await expect(unit.left).toBeGreaterThanOrEqual(box.left);
    await expect(unit.right).toBeLessThanOrEqual(box.right);
    await expect(unit.top).toBeGreaterThanOrEqual(box.top);
    await expect(unit.bottom).toBeLessThanOrEqual(box.bottom);
    await expect(unit.left).toBeGreaterThanOrEqual(input.getBoundingClientRect().right - 1);
  },
};

export const NumericKeyboard: Story = {
  name: 'Screen reader and keypad: a numeric spinbutton',
  render: () => <Harness initial={15} min={1} max={120} suffix="min" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole('spinbutton', { name: 'Timeout' });
    await expect(input).toHaveAttribute('inputmode', 'numeric');
    await expect(input).toHaveAttribute('aria-valuemin', '1');
    await expect(input).toHaveAttribute('aria-valuemax', '120');
    await expect(input.getAttribute('aria-describedby')).toContain(canvas.getByText('min').id);
  },
};
