import Stack from '@mui/material/Stack/index.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { expect, fn,userEvent, within } from 'storybook/test';

import { Checkbox } from './Checkbox';

const meta: Meta<typeof Checkbox> = {
  title: 'Form/Checkbox/Tests',
  component: Checkbox,
  parameters: {
    layout: 'centered',
    chromatic: { disableSnapshot: false },
  },
  tags: ['autodocs', 'test', 'component:Checkbox'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// Basic Interaction Tests
export const BasicInteraction: Story = {
  name: '🧪 Basic Interaction Test',
  args: {
    label: 'Test Checkbox',
    onChange: fn(),
    onClick: fn(),
    onFocus: fn(),
    onBlur: fn(),
  },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('Initial render verification', async () => {
      const checkbox = canvas.getByRole('checkbox', { name: /test checkbox/i });
      await expect(checkbox).toBeInTheDocument();
      await expect(checkbox).not.toBeChecked();
    });

    await step('Click to check', async () => {
      const checkbox = canvas.getByRole('checkbox', { name: /test checkbox/i });
      await userEvent.click(checkbox);
      await expect(checkbox).toBeChecked();
    });
  },
};

export const KeyboardNavigation: Story = {
  name: '⌨️ Keyboard Navigation Test',
  render: () => (
    <Stack spacing={2}>
      <Checkbox label="First checkbox" />
      <Checkbox label="Second checkbox" />
    </Stack>
  ),
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('Tab navigation', async () => {
      const firstCheckbox = canvas.getByRole('checkbox', { name: /first checkbox/i });
      await expect(firstCheckbox).toBeInTheDocument();
    });
  },
};

export const FocusManagement: Story = {
  name: '🎯 Focus Management Test',
  render: () => (
    <Stack spacing={2}>
      <Checkbox autoFocus label="Auto-focus checkbox" />
      <Checkbox label="Regular checkbox" />
    </Stack>
  ),
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('Auto focus', async () => {
      const autoFocusCheckbox = canvas.getByRole('checkbox', { name: /auto-focus checkbox/i });
      await expect(autoFocusCheckbox).toBeInTheDocument();
    });
  },
};

export const VisualStates: Story = {
  name: '👁️ Visual States Test',
  render: () => (
    <Stack spacing={2}>
      <Checkbox label="Default state" />
      <Checkbox label="Checked state" defaultChecked />
      <Checkbox label="Disabled state" disabled />
    </Stack>
  ),
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('Default state', async () => {
      const checkbox = canvas.getByRole('checkbox', { name: /default state/i });
      await expect(checkbox).not.toBeChecked();
    });
  },
};

export const ResponsiveDesign: Story = {
  name: '📱 Responsive Design Test',
  render: () => (
    <Stack spacing={2}>
      <Checkbox label="Mobile checkbox" size="small" />
      <Checkbox label="Tablet checkbox" size="medium" />
      <Checkbox label="Desktop checkbox" size="large" />
    </Stack>
  ),
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('Responsive layout', async () => {
      const checkboxes = canvas.getAllByRole('checkbox');
      await expect(checkboxes).toHaveLength(3);
    });
  },
};

export const ThemeVariations: Story = {
  name: '🎨 Theme Variations Test',
  render: () => (
    <Stack spacing={2}>
      <Checkbox label="Primary checkbox" color="primary" defaultChecked />
      <Checkbox label="Secondary checkbox" color="secondary" defaultChecked />
    </Stack>
  ),
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('Theme colors', async () => {
      const checkboxes = canvas.getAllByRole('checkbox');
      await expect(checkboxes).toHaveLength(2);
    });
  },
};

export const EdgeCases: Story = {
  name: '🔧 Edge Cases Test',
  render: () => (
    <Stack spacing={2}>
      <Checkbox label="Long text that wraps around multiple lines to test layout" />
      <Checkbox label="Unicode: 🚀 ✨ 💫" />
    </Stack>
  ),
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('Edge cases', async () => {
      const checkboxes = canvas.getAllByRole('checkbox');
      await expect(checkboxes).toHaveLength(2);
    });
  },
};

export const Integration: Story = {
  name: '🔗 Integration Test',
  render: () => {
    const [checked, setChecked] = React.useState(false);
    return (
      <Checkbox
        label="Integration test"
        checked={checked}
        onChange={(e, value) => setChecked(value)}
      />
    );
  },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('Integration test', async () => {
      const checkbox = canvas.getByRole('checkbox', { name: /integration test/i });
      await expect(checkbox).not.toBeChecked();

      await userEvent.click(checkbox);
      await expect(checkbox).toBeChecked();
    });
  },
};

/**
 * `size` SPEAKS THE HOUSE `SizeValue` VOCABULARY (FUT-2771).
 *
 * `xs`/`sm` collapse onto the same glyph MUI's own `small` draws, `md` onto
 * `medium`, `lg`/`xl` onto `large` — the same collapse `muiSize()` gives every
 * other sized component. MUI's own deprecated words stay the geometry's source
 * of truth here, so a regression in either direction (the new vocabulary
 * drifting from it, or the deprecated words themselves moving) fails this.
 */
export const SizeVocabulary: Story = {
  name: '📐 Size Vocabulary Test',
  render: () => (
    <Stack direction="row" spacing={2} flexWrap="wrap">
      <Checkbox dataTestId="size-xs" size="xs" defaultChecked />
      <Checkbox dataTestId="size-sm" size="sm" defaultChecked />
      <Checkbox dataTestId="size-md" size="md" defaultChecked />
      <Checkbox dataTestId="size-lg" size="lg" defaultChecked />
      <Checkbox dataTestId="size-xl" size="xl" defaultChecked />
      <Checkbox dataTestId="size-legacy-small" size="small" defaultChecked />
      <Checkbox dataTestId="size-legacy-medium" size="medium" defaultChecked />
      <Checkbox dataTestId="size-legacy-large" size="large" defaultChecked />
    </Stack>
  ),
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    const glyphWidth = (testId: string): number => {
      const svg = canvas.getByTestId(testId).querySelector('svg');
      if (!svg) throw new Error(`no glyph rendered for ${testId}`);
      return svg.getBoundingClientRect().width;
    };

    // Chromium rounds layout to 1/64px, so these compare with 0 fractional
    // digits (±0.5px) rather than as exact strings or exact floats.
    await step('xs and sm draw the same glyph MUI’s own small draws', async () => {
      const small = glyphWidth('size-legacy-small');
      await expect(glyphWidth('size-xs')).toBeCloseTo(small, 0);
      await expect(glyphWidth('size-sm')).toBeCloseTo(small, 0);
    });

    await step('md draws the same glyph MUI’s own medium draws', async () => {
      await expect(glyphWidth('size-md')).toBeCloseTo(glyphWidth('size-legacy-medium'), 0);
    });

    await step('lg and xl draw the same glyph MUI’s own large draws', async () => {
      const large = glyphWidth('size-legacy-large');
      await expect(glyphWidth('size-lg')).toBeCloseTo(large, 0);
      await expect(glyphWidth('size-xl')).toBeCloseTo(large, 0);
    });

    await step('the three MUI steps stay visibly distinct from each other', async () => {
      const small = glyphWidth('size-legacy-small');
      const medium = glyphWidth('size-legacy-medium');
      const large = glyphWidth('size-legacy-large');
      await expect(medium).toBeGreaterThan(small);
      await expect(large).toBeGreaterThan(medium);
    });
  },
};
