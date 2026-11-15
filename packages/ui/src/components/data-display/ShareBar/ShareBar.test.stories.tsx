import Box from '@mui/material/Box/index.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor, within } from 'storybook/test';

import { ShareBar } from './ShareBar';

const meta: Meta<typeof ShareBar> = {
  title: 'Data Display/ShareBar/Tests',
  component: ShareBar,
  parameters: { layout: 'padded', chromatic: { disableSnapshot: false } },
  tags: ['autodocs', 'test', 'component:ShareBar'],
  args: {
    label: 'Vendas por forma de pagamento',
    dataTestId: 'pay',
    segments: [
      { key: 'pix', label: 'Pix', value: 4520 },
      { key: 'credit', label: 'Crédito', value: 3110 },
      { key: 'debit', label: 'Débito', value: 1460 },
      { key: 'cash', label: 'Dinheiro', value: 610 },
      { key: 'voucher', label: 'Vale-refeição muito longo de nome', value: 180 },
    ],
    formatValue: (value: number) => `R$ ${value}`,
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing inside `element` is wider than `element` itself. */
function unclipped(element: Element): boolean {
  return element.scrollWidth <= element.clientWidth + 1;
}

async function assertNothingClipped(canvasElement: HTMLElement): Promise<void> {
  const canvas = within(canvasElement);
  // The inline percents appear once the bar has measured itself.
  await waitFor(() => expect(canvasElement.querySelectorAll('[data-share-inline]').length).toBeGreaterThan(0));
  for (const label of canvasElement.querySelectorAll('[data-share-inline]')) {
    const segment = label.parentElement;
    await expect(segment).not.toBeNull();
    if (segment) await expect(unclipped(segment)).toBe(true);
  }
  for (const item of canvas.getAllByRole('listitem')) {
    await expect(unclipped(item)).toBe(true);
  }
  await expect(unclipped(canvas.getByTestId('pay'))).toBe(true);
}

export const WideNothingClipped: Story = {
  name: '🧪 Layout — no percent or row is clipped at 640px',
  decorators: [
    (Story) => (
      <Box sx={{ width: 640 }}>
        <Story />
      </Box>
    ),
  ],
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    await step('Every part is listed, named, in order, with whole percents adding to 100', async () => {
      const list = canvas.getByRole('list', { name: 'Vendas por forma de pagamento' });
      const items = within(list).getAllByRole('listitem');
      await expect(items).toHaveLength(5);
      await expect(items[0]).toHaveTextContent('Pix');
      const total = items
        .map((item) => Number(/(\d+)%/.exec(item.textContent ?? '')?.[1] ?? 0))
        .reduce((sum, value) => sum + value, 0);
      await expect(total).toBe(100);
    });
    await step('No inline percent, row or the root is clipped', async () => {
      await assertNothingClipped(canvasElement);
    });
  },
};

export const PhoneNothingClipped: Story = {
  name: '🧪 Layout — no percent or row is clipped at 320px',
  decorators: [
    (Story) => (
      <Box sx={{ width: 320 }}>
        <Story />
      </Box>
    ),
  ],
  play: async ({ canvasElement, step }) => {
    await step('A thin part keeps its percent out of the bar rather than cut', async () => {
      await assertNothingClipped(canvasElement);
      const thin = within(canvasElement).getByTestId('pay-segment-voucher');
      await expect(thin.querySelectorAll('[data-share-inline]')).toHaveLength(0);
    });
  },
};
