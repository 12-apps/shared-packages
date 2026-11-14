import Box from '@mui/material/Box/index.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { HeatMap } from './HeatMap';

const meta: Meta<typeof HeatMap> = {
  title: 'Data Display/HeatMap/Tests',
  component: HeatMap,
  parameters: { layout: 'padded' },
  tags: ['autodocs', 'test', 'component:HeatMap'],
  args: {
    rows: [
      { key: '1', label: 'Seg' },
      { key: '2', label: 'Ter' },
    ],
    columns: Array.from({ length: 24 }, (_, hour) => ({ key: `${hour}`, label: `${hour}h` })),
    // A rising row that ends at 58% in the last hour. Written out rather than
    // `hour / 40`: 23 / 40 * 100 is 57.49999… in floating point, so that cell
    // printed "57%" and the play test looked for a cell that was never drawn.
    cells: Array.from({ length: 24 }, (_, hour) => ({
      row: '1',
      column: `${hour}`,
      value: hour === 23 ? 0.58 : hour / 50,
    })),
    scale: { target: 0.3 },
    formatValue: (value: number) => `${Math.round(value * 100)}%`,
    labels: { above: 'acima da meta', below: 'abaixo da meta', empty: 'sem venda na hora' },
    caption: 'Custo / vendas',
    transpose: false,
    dataTestId: 'hm',
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const FitsItsContainer: Story = {
  name: '🧪 Twenty-four columns fit a narrow card with no sideways scroll',
  render: (args) => (
    <Box sx={{ width: '37.5rem' }} data-testid="frame">
      <HeatMap {...args} />
    </Box>
  ),
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    await step('The table is no wider than its frame', async () => {
      const frame = canvas.getByTestId('frame');
      const table = canvas.getByTestId('hm-table');
      await expect(table.getBoundingClientRect().width).toBeLessThanOrEqual(
        frame.getBoundingClientRect().width + 0.5,
      );
    });
    await step('An attention cell is named with its side', async () => {
      await expect(canvas.getByRole('cell', { name: '58% acima da meta' })).toBeInTheDocument();
    });
  },
};
