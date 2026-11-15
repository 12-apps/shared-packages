import Box from '@mui/material/Box/index.js';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { ShareBar } from './ShareBar';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

const meta: Meta<typeof ShareBar> = {
  title: 'Data Display/ShareBar',
  component: ShareBar,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A horizontal 100% bar of parts with their percents, and the same parts as an accessible list. Percents are whole and add to 100; a percent that would not fit its segment is left to the list.',
      },
    },
  },
  tags: ['autodocs'],
  args: {
    label: 'Vendas por forma de pagamento',
    segments: [
      { key: 'pix', label: 'Pix', value: 4520 },
      { key: 'credit', label: 'Crédito', value: 3110 },
      { key: 'debit', label: 'Débito', value: 1460 },
      { key: 'cash', label: 'Dinheiro', value: 610 },
      { key: 'voucher', label: 'Vale-refeição', value: 180 },
    ],
    formatValue: (value: number) => BRL.format(value),
  },
  decorators: [
    (Story) => (
      <Box sx={{ maxWidth: 640 }}>
        <Story />
      </Box>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Phone: Story = {
  decorators: [
    (Story) => (
      <Box sx={{ width: 320 }}>
        <Story />
      </Box>
    ),
  ],
};

export const TwoParts: Story = {
  args: {
    label: 'Pedidos por canal',
    segments: [
      { key: 'store', label: 'Loja', value: 62 },
      { key: 'app', label: 'App', value: 38 },
    ],
    formatValue: undefined,
  },
};
