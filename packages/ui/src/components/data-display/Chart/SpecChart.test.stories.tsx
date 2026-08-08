import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { SpecChart } from './SpecChart';

const meta: Meta<typeof SpecChart> = {
  title: 'Charts/Chart/Tests',
  component: SpecChart,
  parameters: { layout: 'padded' },
  tags: ['autodocs', 'test', 'component:Chart'],
};

export default meta;
type Story = StoryObj<typeof meta>;

const data = [
  { day: 'Seg', total: 125000 },
  { day: 'Ter', total: 98000 },
];

export const SpecRendersFromSpec: Story = {
  args: {
    spec: {
      type: 'bar',
      title: 'Spec Render',
      xAxis: { key: 'day' },
      series: [{ key: 'total', label: 'Total', color: 'primary' }],
      numberFormat: 'brl',
    },
    data,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('spec-chart')).toBeInTheDocument();
    await expect(canvas.getByText('Spec Render')).toBeInTheDocument();
  },
};

export const SpecDonutCenterLabel: Story = {
  args: {
    spec: {
      type: 'donut',
      xAxis: { key: 'method' },
      series: [{ key: 'total' }],
      centerLabel: { label: 'Total', value: 'R$ 100' },
    },
    data: [
      { method: 'PIX', total: 60 },
      { method: 'Cartão', total: 40 },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('spec-chart')).toBeInTheDocument();
  },
};
