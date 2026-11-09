import Box from '@mui/material/Box/index.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import React, { useState } from 'react';

import { Button } from '../../form/Button';

import { StepCardList } from './StepCardList';
import type { StepCardItem } from './StepCardList.types';

const meta: Meta<typeof StepCardList> = {
  title: 'Data Display/StepCardList',
  component: StepCardList,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Every step of a form on screen at once, as a stack of cards. Answered steps collapse into one button that reopens them; the current step draws its face; the rest wait dashed. All words come from the caller.',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: { items: { control: false }, reveal: { control: false }, revealWatch: { control: false } },
  decorators: [
    (Story) => (
      <Box sx={{ width: 'min(100vw - 32px, 420px)' }}>
        <Story />
      </Box>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

const noop = (): void => undefined;

export const States: Story = {
  args: {
    'aria-label': 'Passos',
    items: [
      { id: 'kind', title: 'O que é', state: 'done', answer: 'Farinha de trigo', detail: 'Insumo seco', changeLabel: 'Alterar', onChange: noop },
      { id: 'unit', title: 'Unidade', state: 'error', answer: 'Sem unidade', error: 'Escolha uma unidade', changeLabel: 'Alterar', onChange: noop },
      { id: 'amount', title: 'Quanto', state: 'current', children: <Box sx={{ color: 'text.secondary' }}>O rosto do passo atual</Box> },
      { id: 'price', title: 'Preço', state: 'todo' },
    ] satisfies StepCardItem[],
  },
};

const STEPS = [
  { id: 'kind', title: 'O que é', answers: ['Farinha de trigo', 'Insumo seco'] },
  { id: 'amount', title: 'Quanto', answers: ['5 kg', 'Pacote fechado'] },
  { id: 'price', title: 'Preço', answers: ['R$ 24,00', 'Por kg'] },
] as const;

/** A walk through the steps: Continuar answers the current one, Alterar reopens a done one. */
export const Walkthrough: Story = {
  render: () => {
    const [current, setCurrent] = useState(0);
    const items: StepCardItem[] = STEPS.map((step, index) => ({
      id: step.id,
      title: step.title,
      state: index < current ? 'done' : index === current ? 'current' : 'todo',
      answer: step.answers[0],
      detail: step.answers[1],
      changeLabel: 'Alterar',
      onChange: () => setCurrent(index),
      children: (
        <Button onClick={() => setCurrent(Math.min(index + 1, STEPS.length))}>Continuar</Button>
      ),
    }));
    return <StepCardList aria-label="Passos" items={items} reveal={{ bottomInset: 72 }} />;
  },
};
