import PaidIcon from '@mui/icons-material/Paid';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import Box from '@mui/material/Box/index.js';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { StatCard } from './StatCard';

const meta: Meta<typeof StatCard> = {
  title: 'Cards/StatCard',
  component: StatCard,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'KPI tile: one labelled figure with an optional period-over-period delta, icon, hint and loading state. Values arrive pre-formatted — the tile never formats money or percentages itself.',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    label: { control: 'text' },
    value: { control: 'text' },
    hint: { control: 'text' },
    loading: { control: 'boolean' },
    delta: { control: false },
    icon: { control: false },
    className: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    label: 'Receita',
    value: 'R$ 12.480,00',
  },
};

export const WithPositiveDelta: Story = {
  args: {
    label: 'Receita',
    value: 'R$ 12.480,00',
    delta: { value: '+12,5%', direction: 'up', label: 'vs. período anterior' },
  },
};

export const WithNegativeDelta: Story = {
  args: {
    label: 'Pedidos',
    value: '184',
    delta: { value: '-8,2%', direction: 'down', label: 'vs. período anterior' },
  },
};

export const WithNeutralDelta: Story = {
  args: {
    label: 'Margem',
    value: '62,0%',
    delta: { value: '0,0%', direction: 'neutral', label: 'vs. período anterior' },
  },
};

/**
 * "Lower is better" metrics separate the ARROW from the MEANING: cost rose
 * (`direction: 'up'`) but that reads badly (`tone: 'negative'`).
 */
export const InvertedTone: Story = {
  args: {
    label: 'Custo (CMV)',
    value: 'R$ 4.900,00',
    delta: {
      value: '+9,4%',
      direction: 'up',
      tone: 'negative',
      label: 'vs. período anterior',
    },
  },
};

export const WithIcon: Story = {
  args: {
    label: 'Lucro bruto',
    value: 'R$ 7.580,00',
    icon: <TrendingUpIcon fontSize="small" />,
    delta: { value: '+14,0%', direction: 'up' },
  },
};

export const WithHint: Story = {
  args: {
    label: 'Receita',
    value: 'R$ 12.480,00',
    hint: 'Últimos 30 dias',
  },
};

export const Loading: Story = {
  args: {
    label: 'Receita',
    value: 'R$ 12.480,00',
    delta: { value: '+12,5%', direction: 'up' },
    loading: true,
  },
};

export const LongValueOverflow: Story = {
  args: {
    label: 'Receita acumulada do exercício corrente',
    value: 'R$ 1.284.930.577,25',
    delta: { value: '+1.204,75%', direction: 'up', label: 'vs. período anterior' },
  },
  decorators: [
    (Story) => (
      <Box sx={{ width: 220 }}>
        <Story />
      </Box>
    ),
  ],
};

/** The dashboard shape: a responsive grid of tiles sharing one range. */
export const KpiGrid: Story = {
  render: () => (
    <Box
      sx={{
        display: 'grid',
        gap: 2,
        gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },
        width: { xs: 280, sm: 520, md: 880 },
      }}
    >
      <StatCard
        label="Receita"
        value="R$ 12.480,00"
        icon={<PaidIcon fontSize="small" />}
        delta={{ value: '+12,5%', direction: 'up', label: 'vs. período anterior' }}
        dataTestId="kpi-revenue"
      />
      <StatCard
        label="Custo (CMV)"
        value="R$ 4.900,00"
        icon={<ReceiptLongIcon fontSize="small" />}
        delta={{ value: '+9,4%', direction: 'up', tone: 'negative', label: 'vs. período anterior' }}
        dataTestId="kpi-cogs"
      />
      <StatCard
        label="Lucro bruto"
        value="R$ 7.580,00"
        icon={<TrendingUpIcon fontSize="small" />}
        delta={{ value: '+14,0%', direction: 'up', label: 'vs. período anterior' }}
        dataTestId="kpi-profit"
      />
      <StatCard
        label="Pedidos"
        value="184"
        icon={<ShoppingCartIcon fontSize="small" />}
        delta={{ value: '-8,2%', direction: 'down', label: 'vs. período anterior' }}
        dataTestId="kpi-orders"
      />
    </Box>
  ),
};
