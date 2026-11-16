import Box from '@mui/material/Box/index.js';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { HeatMap } from './HeatMap';
import type { HeatMapCell } from './HeatMap.types';

const WEEKDAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map((label, index) => ({
  key: `${index + 1}`,
  label,
}));
const HOURS = Array.from({ length: 14 }, (_, index) => ({ key: `${index + 10}`, label: `${index + 10}h` }));

/** A plausible week: busy lunches and late nights over target, the 23h with no sale on weekdays. */
function sampleCells(): HeatMapCell[] {
  const cells: HeatMapCell[] = [];
  WEEKDAYS.forEach((day, d) => {
    HOURS.forEach((hour, h) => {
      const late = h === HOURS.length - 1 && d < 5;
      const wave = 0.32 + 0.2 * Math.cos((h / 3) * Math.PI) - 0.02 * d;
      cells.push({ row: day.key, column: hour.key, value: late ? null : Math.max(0.05, wave) });
    });
  });
  return cells;
}

const meta: Meta<typeof HeatMap> = {
  title: 'Data Display/HeatMap',
  component: HeatMap,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A diverging heat map around a target, drawn as a table: amber and bold above the target, blue at or under it, "—" for a cell with no figure. Transposed below `md`. Every word comes from the host.',
      },
    },
  },
  tags: ['autodocs'],
  args: {
    rows: WEEKDAYS,
    columns: HOURS,
    cells: sampleCells(),
    scale: { target: 0.3, strongAbove: 0.45, strongBelow: 0.18 },
    formatValue: (value: number) => `${Math.round(value * 100)}%`,
    labels: { above: 'acima da meta', below: 'abaixo da meta', empty: 'sem venda na hora' },
    caption: 'Custo / vendas por dia da semana e hora',
  },
  argTypes: {
    transpose: { control: 'select', options: ['auto', true, false] },
    legend: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { transpose: false },
};

export const Transposed: Story = {
  args: { transpose: true },
  render: (args) => (
    <Box sx={{ maxWidth: '24rem' }}>
      <HeatMap {...args} />
    </Box>
  ),
};

export const Auto: Story = {
  args: { transpose: 'auto' },
};
