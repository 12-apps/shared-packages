import Stack from '@mui/material/Stack/index.js';
import Typography from '@mui/material/Typography/index.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import React, { useState } from 'react';

import { NumberField } from './NumberField';
import type { NumberFieldProps } from './NumberField.types';

const meta: Meta<typeof NumberField> = {
  title: 'Form/NumberField',
  component: NumberField,
  args: { label: 'Preparation time', value: 15, onChange: () => undefined },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A digits-only numeric input whose value is `number | null` (`null` = empty). `inputMode="numeric"` raises the number pad; non-digit keystrokes are refused and a paste keeps only its digits; `suffix` is drawn inside the field; ArrowUp / ArrowDown step by `step` within `min` / `max`.',
      },
    },
  },
  tags: ['autodocs', 'component:NumberField'],
  argTypes: {
    min: { control: 'number' },
    max: { control: 'number' },
    step: { control: 'number' },
    suffix: { control: 'text' },
    disabled: { control: 'boolean' },
    error: { control: 'boolean' },
    helperText: { control: 'text' },
    size: { control: 'inline-radio', options: ['xs', 'sm', 'md', 'lg', 'xl'] },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

/** Controlled, with the value it reports printed under it. */
function Controlled({ initial = 15, ...props }: Partial<NumberFieldProps> & { initial?: number | null }): React.ReactElement {
  const [value, setValue] = useState<number | null>(initial);
  return (
    <Stack spacing={1} sx={{ maxWidth: 280 }}>
      <NumberField label="Preparation time" {...props} value={value} onChange={setValue} />
      <Typography variant="caption" color="text.secondary" data-testid="reported">
        {`value: ${value === null ? 'null' : value}`}
      </Typography>
    </Stack>
  );
}

export const Default: Story = { render: () => <Controlled /> };

/** The unit sits inside the field's border. */
export const WithSuffix: Story = { render: () => <Controlled suffix="min" /> };

/** Arrows stop at 5 and 120, in steps of 5; a blur pulls a typed 3 up to 5. */
export const WithBounds: Story = {
  render: () => <Controlled suffix="min" min={5} max={120} step={5} helperText="Between 5 and 120, in steps of 5" />,
};

/** Cleared: the field reports `null`, not 0. */
export const Empty: Story = { render: () => <Controlled initial={null} placeholder="Not set" suffix="min" /> };

export const WithError: Story = {
  render: () => <Controlled initial={0} error helperText="Must be at least 1" suffix="items" />,
};

export const Disabled: Story = { render: () => <Controlled disabled suffix="min" /> };

export const Sizes: Story = {
  render: () => (
    <Stack spacing={2}>
      {(['xs', 'sm', 'md', 'lg', 'xl'] as const).map((size) => (
        <Controlled key={size} size={size} suffix="kg" label={`Size ${size}`} />
      ))}
    </Stack>
  ),
};

/** A long suffix and a fifteen-digit value — the most the field keeps. */
export const EdgeCases: Story = {
  render: () => (
    <Stack spacing={2}>
      <Controlled initial={999999999999999} label="Largest value kept" />
      <Controlled initial={3} suffix="minutes per order" label="Long suffix" />
    </Stack>
  ),
};
