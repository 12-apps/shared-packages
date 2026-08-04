import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';

import { SpecChart } from './SpecChart';
import type { ChartSpec } from './ChartSpec.types';

const meta: Meta<typeof SpecChart> = {
  title: 'DataDisplay/SpecChart',
  component: SpecChart,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Renders a chart from a JSON-serializable ChartSpec plus plain data rows. ' +
          'The spec API is layered over the prop-driven Chart — same implementation, ' +
          'declarative surface for report builders and LLM authoring.',
      },
    },
  },
  tags: ['autodocs', 'component:Chart'],
};

export default meta;
type Story = StoryObj<typeof meta>;

const salesByDay = [
  { day: 'Seg', total: 125000, perdas: 4500 },
  { day: 'Ter', total: 98000, perdas: 1200 },
  { day: 'Qua', total: 143500, perdas: 0 },
  { day: 'Qui', total: 110200, perdas: 7300 },
  { day: 'Sex', total: 189900, perdas: 2100 },
];

const paymentMethods = [
  { method: 'PIX', total: 420000 },
  { method: 'Cartão', total: 310000 },
  { method: 'Garçom', total: 86000 },
];

const lineSpec: ChartSpec = {
  type: 'line',
  title: 'Vendas por dia',
  subtitle: 'Receita líquida (BRL)',
  xAxis: { key: 'day' },
  series: [{ key: 'total', label: 'Total', color: 'primary' }],
  numberFormat: 'brl',
};

export const Line: Story = {
  args: { spec: lineSpec, data: salesByDay },
};

export const StackedBars: Story = {
  args: {
    spec: {
      type: 'bar',
      title: 'Vendas vs perdas',
      xAxis: { key: 'day' },
      series: [
        { key: 'total', label: 'Vendas', color: 'primary' },
        { key: 'perdas', label: 'Perdas', color: 'error' },
      ],
      stacked: true,
      numberFormat: 'brl',
    },
    data: salesByDay,
  },
};

export const Area: Story = {
  args: {
    spec: { ...lineSpec, type: 'area', title: 'Tendência de vendas' },
    data: salesByDay,
  },
};

export const Pie: Story = {
  args: {
    spec: {
      type: 'pie',
      title: 'Formas de pagamento',
      xAxis: { key: 'method' },
      series: [{ key: 'total' }],
      numberFormat: 'brl',
    },
    data: paymentMethods,
  },
};

export const Donut: Story = {
  args: {
    spec: {
      type: 'donut',
      title: 'Formas de pagamento',
      xAxis: { key: 'method' },
      series: [{ key: 'total' }],
      numberFormat: 'brl',
      centerLabel: { label: 'Total', value: 'R$ 8.160' },
    },
    data: paymentMethods,
  },
};

export const PercentFormat: Story = {
  args: {
    spec: {
      type: 'bar',
      title: 'Margem por dia',
      xAxis: { key: 'day' },
      series: [{ key: 'margin', label: 'Margem', color: 'success' }],
      numberFormat: 'percent',
      legend: false,
    },
    data: salesByDay.map((row) => ({ day: row.day, margin: row.total > 0 ? 0.2 + row.perdas / row.total : 0 })),
  },
};

export const CustomColorScheme: Story = {
  args: {
    spec: {
      ...lineSpec,
      type: 'bar',
      title: 'Esquema de cores custom',
      series: [
        { key: 'total', label: 'Total' },
        { key: 'perdas', label: 'Perdas' },
      ],
      colorScheme: ['info', 'warning'],
    },
    data: salesByDay,
  },
};

export const FromJsonString: Story = {
  render: () => {
    const json =
      '{"type":"area","title":"Spec vinda de JSON","xAxis":{"key":"day"},' +
      '"series":[{"key":"total","label":"Total","color":"secondary"}],"numberFormat":"compact"}';
    return <SpecChart spec={JSON.parse(json) as ChartSpec} data={salesByDay} />;
  },
};

export const Loading: Story = {
  args: { spec: lineSpec, data: [], loading: true },
};

export const Empty: Story = {
  args: { spec: { ...lineSpec, title: 'Sem dados' }, data: [] },
};
