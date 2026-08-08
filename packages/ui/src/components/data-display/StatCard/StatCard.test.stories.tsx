import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import { Box } from '@mui/material';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor, within } from 'storybook/test';

import { StatCard } from './StatCard';

const meta: Meta<typeof StatCard> = {
  title: 'Cards/StatCard/Tests',
  component: StatCard,
  parameters: {
    layout: 'padded',
    chromatic: { disableSnapshot: false },
  },
  tags: ['autodocs', 'test', 'component:StatCard'],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const BasicInteraction: Story = {
  name: '🧪 Renders label and value',
  args: {
    label: 'Receita',
    value: 'R$ 12.480,00',
    dataTestId: 'kpi-revenue',
  },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('Tile root is present', async () => {
      await expect(canvas.getByTestId('kpi-revenue')).toBeInTheDocument();
    });

    await step('Label and value render their text', async () => {
      await expect(canvas.getByTestId('kpi-revenue-label')).toHaveTextContent('Receita');
      await expect(canvas.getByTestId('kpi-revenue-value')).toHaveTextContent('R$ 12.480,00');
    });

    await step('No delta renders when none is passed', async () => {
      await waitFor(() =>
        expect(canvas.queryByTestId('kpi-revenue-delta')).not.toBeInTheDocument(),
      );
    });
  },
};

export const ScreenReaderTest: Story = {
  name: '🧪 Screen Reader — labelled group and delta sentence',
  args: {
    label: 'Receita',
    value: 'R$ 12.480,00',
    delta: { value: '+12,5%', direction: 'up', label: 'vs. período anterior' },
    dataTestId: 'kpi-revenue',
  },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('The tile is a group labelled by its own label element', async () => {
      const group = canvas.getByRole('group', { name: 'Receita' });
      await expect(group).toBe(canvas.getByTestId('kpi-revenue'));
    });

    await step('The delta exposes a direction-aware sentence', async () => {
      await expect(
        canvas.getByLabelText('Increase of +12,5% vs. período anterior'),
      ).toBeInTheDocument();
    });
  },
};

export const VisualStateUpDelta: Story = {
  name: '🧪 Visual State — upward delta reads positive',
  args: {
    label: 'Lucro bruto',
    value: 'R$ 7.580,00',
    icon: <TrendingUpIcon fontSize="small" />,
    delta: { value: '+14,0%', direction: 'up' },
    dataTestId: 'kpi-profit',
  },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('Direction and tone are exposed on the delta row', async () => {
      const delta = canvas.getByTestId('kpi-profit-delta');
      await expect(delta).toHaveAttribute('data-direction', 'up');
      await expect(delta).toHaveAttribute('data-tone', 'positive');
    });

    await step('The leading icon renders and is hidden from assistive tech', async () => {
      await expect(canvas.getByTestId('kpi-profit-icon')).toHaveAttribute('aria-hidden', 'true');
    });
  },
};

export const VisualStateDownDelta: Story = {
  name: '🧪 Visual State — downward delta reads negative',
  args: {
    label: 'Pedidos',
    value: '184',
    delta: { value: '-8,2%', direction: 'down' },
    dataTestId: 'kpi-orders',
  },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('Direction and tone are exposed on the delta row', async () => {
      const delta = canvas.getByTestId('kpi-orders-delta');
      await expect(delta).toHaveAttribute('data-direction', 'down');
      await expect(delta).toHaveAttribute('data-tone', 'negative');
    });

    await step('The generated sentence says "Decrease"', async () => {
      await expect(canvas.getByLabelText('Decrease of -8,2%')).toBeInTheDocument();
    });
  },
};

export const EdgeCaseInvertedTone: Story = {
  name: '🧪 Edge Case — rising cost keeps the up arrow but reads negative',
  args: {
    label: 'Custo (CMV)',
    value: 'R$ 4.900,00',
    delta: { value: '+9,4%', direction: 'up', tone: 'negative' },
    dataTestId: 'kpi-cogs',
  },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('Arrow direction and semantic tone are independent', async () => {
      const delta = canvas.getByTestId('kpi-cogs-delta');
      await expect(delta).toHaveAttribute('data-direction', 'up');
      await expect(delta).toHaveAttribute('data-tone', 'negative');
    });
  },
};

export const EdgeCaseLocalizedAria: Story = {
  name: '🧪 Edge Case — ariaLabel overrides the English sentence',
  args: {
    label: 'Receita',
    value: 'R$ 12.480,00',
    delta: {
      value: '+12,5%',
      direction: 'up',
      ariaLabel: 'Aumento de 12,5% em relação ao período anterior',
    },
    dataTestId: 'kpi-revenue',
  },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('The override wins over the generated text', async () => {
      await expect(
        canvas.getByLabelText('Aumento de 12,5% em relação ao período anterior'),
      ).toBeInTheDocument();
      await waitFor(() =>
        expect(canvas.queryByLabelText('Increase of +12,5%')).not.toBeInTheDocument(),
      );
    });
  },
};

export const LoadingStateTest: Story = {
  name: '🧪 Loading State — skeletons replace value and delta',
  args: {
    label: 'Receita',
    value: 'R$ 12.480,00',
    delta: { value: '+12,5%', direction: 'up' },
    loading: true,
    dataTestId: 'kpi-revenue',
  },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('The tile announces itself as busy', async () => {
      await expect(canvas.getByTestId('kpi-revenue')).toHaveAttribute('aria-busy', 'true');
    });

    await step('Value and delta are replaced by skeletons', async () => {
      await expect(canvas.getByTestId('kpi-revenue-value-skeleton')).toBeInTheDocument();
      await expect(canvas.getByTestId('kpi-revenue-delta-skeleton')).toBeInTheDocument();
      await waitFor(() => {
        expect(canvas.queryByTestId('kpi-revenue-value')).not.toBeInTheDocument();
        expect(canvas.queryByTestId('kpi-revenue-delta')).not.toBeInTheDocument();
      });
    });

    await step('The label survives the loading swap (no reflow)', async () => {
      await expect(canvas.getByTestId('kpi-revenue-label')).toHaveTextContent('Receita');
    });
  },
};

export const ResponsiveDesign: Story = {
  name: '🧪 Responsive Design — tiles stack in a narrow grid',
  parameters: { viewport: { defaultViewport: 'mobile1' } },
  render: () => (
    <Box
      sx={{
        display: 'grid',
        gap: 2,
        gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' },
      }}
    >
      <StatCard label="Receita" value="R$ 12.480,00" dataTestId="kpi-revenue" />
      <StatCard label="Pedidos" value="184" dataTestId="kpi-orders" />
    </Box>
  ),
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('Both tiles render inside the grid', async () => {
      await expect(canvas.getByTestId('kpi-revenue')).toBeVisible();
      await expect(canvas.getByTestId('kpi-orders')).toBeVisible();
    });
  },
};

export const IntegrationHintAndIcon: Story = {
  name: '🧪 Integration — icon, hint and delta compose',
  args: {
    label: 'Margem',
    value: '62,0%',
    hint: 'Últimos 30 dias',
    icon: <TrendingUpIcon fontSize="small" />,
    delta: { value: '+1,4 p.p.', direction: 'up', label: 'vs. período anterior' },
    dataTestId: 'kpi-margin',
  },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('Every optional slot renders together', async () => {
      await expect(canvas.getByTestId('kpi-margin-icon')).toBeInTheDocument();
      await expect(canvas.getByTestId('kpi-margin-hint')).toHaveTextContent('Últimos 30 dias');
      await expect(canvas.getByTestId('kpi-margin-delta')).toHaveAttribute('data-direction', 'up');
      await expect(canvas.getByTestId('kpi-margin-value')).toHaveTextContent('62,0%');
    });
  },
};
