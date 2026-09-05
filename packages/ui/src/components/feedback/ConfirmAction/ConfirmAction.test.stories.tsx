import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { PT_BR_CONFIRM_ACTION_COPY } from '../../../pt-BR';
import { Button } from '../../form/Button';

import { ConfirmAction } from './ConfirmAction';
import { createConfirmButton } from './ConfirmButton';

/** `copy` and `errorText` are required props; there are no default sentences. */
const COPY = PT_BR_CONFIRM_ACTION_COPY;

/** `ConfirmButton` is BUILT from copy, not imported ready-made. */
const ConfirmButton = createConfirmButton(COPY, COPY.defaultError);

const meta: Meta<typeof ConfirmAction> = {
  title: 'Overlays/ConfirmAction/Tests',
  component: ConfirmAction,
  parameters: {
    layout: 'centered',
    chromatic: { disableSnapshot: false },
  },
  tags: ['autodocs', 'test', 'component:ConfirmAction'],
};

export default meta;
type Story = StoryObj<typeof meta>;

const BASE = {
  title: 'Excluir a categoria?',
  description: 'Ela vai para a lixeira e pode ser restaurada de lá.',
  confirmText: 'Excluir',
};

/** `BASE` plus the two props `ConfirmAction` cannot render without. */
const SPOKEN = { ...BASE, copy: COPY, errorText: COPY.defaultError };

/** The popup lives on `document.body`, so queries run against the whole screen. */
const body = (): ReturnType<typeof within> => within(document.body);

export const OpensWithoutRunningTheAction: Story = {
  name: '🧪 Trigger opens the popup and runs nothing',
  args: {
    ...SPOKEN,
    onConfirm: fn(),
    children: (request) => (
      <Button color="danger" onClick={request}>
        Excluir
      </Button>
    ),
  },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Excluir' }));

    await expect(body().getByText('Excluir a categoria?')).toBeInTheDocument();
    await expect(args.onConfirm).not.toHaveBeenCalled();
  },
};

export const CancelSendsNothing: Story = {
  name: '🧪 Cancel sends nothing',
  args: { ...OpensWithoutRunningTheAction.args, onConfirm: fn() },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Excluir' }));
    await userEvent.click(body().getByTestId('confirm-action-cancel-button'));

    await expect(args.onConfirm).not.toHaveBeenCalled();
  },
};

export const ConfirmRunsTheAction: Story = {
  name: '🧪 Confirm runs the action once',
  args: { ...OpensWithoutRunningTheAction.args, onConfirm: fn() },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Excluir' }));
    await userEvent.click(body().getByTestId('confirm-action-confirm-button'));

    await expect(args.onConfirm).toHaveBeenCalledTimes(1);
  },
};

export const TypeToConfirmGate: Story = {
  name: '🧪 Type-to-confirm gates the confirm button',
  args: {
    ...OpensWithoutRunningTheAction.args,
    onConfirm: fn(),
    typeToConfirm: 'Bebidas',
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Excluir' }));

    await expect(body().getByTestId('confirm-action-confirm-button')).toBeDisabled();
    await userEvent.type(body().getByTestId('confirm-action-type-to-confirm'), 'Bebidas');
    await expect(body().getByTestId('confirm-action-confirm-button')).toBeEnabled();
  },
};

export const KeyboardCancelsWithEscape: Story = {
  name: '🧪 Escape closes without running the action',
  args: { ...OpensWithoutRunningTheAction.args, onConfirm: fn() },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Excluir' }));
    await userEvent.keyboard('{Escape}');

    await expect(args.onConfirm).not.toHaveBeenCalled();
  },
};

export const HocGuardsTheWrappedButton: StoryObj = {
  name: '🧪 withConfirmation guards the wrapped button',
  render: (_args, { args }) => (
    <ConfirmButton color="danger" onClick={args.onClick} confirm={BASE}>
      Excluir
    </ConfirmButton>
  ),
  args: { onClick: fn() },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Excluir' }));
    await expect(args.onClick).not.toHaveBeenCalled();

    await userEvent.click(body().getByTestId('confirm-action-confirm-button'));
    await expect(args.onClick).toHaveBeenCalledTimes(1);
  },
};
