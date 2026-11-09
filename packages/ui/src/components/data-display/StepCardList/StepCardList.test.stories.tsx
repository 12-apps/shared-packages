import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { Walkthrough } from './StepCardList.stories';
import { StepCardList } from './StepCardList';

const meta: Meta<typeof StepCardList> = {
  title: 'Data Display/StepCardList/Tests',
  component: StepCardList,
  parameters: { layout: 'padded' },
  tags: ['autodocs', 'test', 'component:StepCardList'],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const ContinueThenChange: Story = {
  name: '🧪 Continuar answers a step, Alterar reopens it',
  render: Walkthrough.render,
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('Only the first step is current', async () => {
      await expect(canvas.getByTestId('step-card-list-kind')).toHaveAttribute('aria-current', 'step');
    });

    await step('Continuar collapses it into a button and moves on', async () => {
      await userEvent.click(canvas.getByRole('button', { name: 'Continuar' }));
      await expect(canvas.getByTestId('step-card-list-kind')).toHaveAttribute('data-state', 'done');
      await expect(canvas.getByTestId('step-card-list-amount')).toHaveAttribute('aria-current', 'step');
      await waitFor(() => expect(canvas.getByRole('heading', { name: 'Quanto' })).toHaveFocus());
    });

    await step('Alterar reopens the answered step', async () => {
      await userEvent.click(canvas.getByTestId('step-card-list-kind-change'));
      await expect(canvas.getByTestId('step-card-list-kind')).toHaveAttribute('aria-current', 'step');
    });
  },
};
