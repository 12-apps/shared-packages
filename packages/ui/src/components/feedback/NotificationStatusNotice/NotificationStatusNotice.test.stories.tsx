import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { PT_BR_NOTIFICATION_UNBLOCK_COPY } from '../../../pt-BR';

import { NotificationStatusNotice } from './NotificationStatusNotice';

const STEPS = PT_BR_NOTIFICATION_UNBLOCK_COPY.chrome.desktop;

const meta: Meta<typeof NotificationStatusNotice> = {
  title: 'Feedback/NotificationStatusNotice/Tests',
  component: NotificationStatusNotice,
  parameters: { layout: 'padded', chromatic: { disableSnapshot: false } },
  tags: ['autodocs', 'test', 'component:NotificationStatusNotice'],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const EnableCallsTheHost: Story = {
  name: '🧪 Disabled: the action asks the host',
  args: {
    status: 'disabled',
    title: 'Suas notificações estão desligadas.',
    enableLabel: 'Ligar notificações',
    onEnable: fn(),
  },
  play: async ({ args, canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('the notice is a polite status, not an interruption', async () => {
      const root = canvas.getByTestId('notification-status-notice');
      await expect(root).toHaveAttribute('role', 'status');
      await expect(root).toHaveAttribute('data-status', 'disabled');
    });

    await step('pressing the action calls onEnable once', async () => {
      await userEvent.click(canvas.getByTestId('notification-status-notice-enable'));
      await expect((args as { onEnable: () => void }).onEnable).toHaveBeenCalledTimes(1);
    });
  },
};

export const StepsDisclosureByKeyboard: Story = {
  name: '🧪 Blocked: the steps open and close from the keyboard',
  args: {
    status: 'blocked',
    title: 'As notificações estão bloqueadas neste navegador.',
    stepsToggleLabel: 'Habilitar novamente',
    steps: STEPS,
  },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    const toggle = canvas.getByTestId('notification-status-notice-steps-toggle');
    const list = canvas.getByTestId('notification-status-notice-steps');

    await step('collapsed at first, and says so', async () => {
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await waitFor(() => expect(list).not.toBeVisible());
    });

    await step('Enter opens it and every step shows, in order', async () => {
      // The notice root takes the first tab stop (Alert is focusable), the
      // disclosure the second.
      await userEvent.tab();
      await userEvent.tab();
      await waitFor(() => expect(toggle).toHaveFocus());
      await userEvent.keyboard('{Enter}');
      await waitFor(() => expect(list).toBeVisible());
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      const items = Array.from(list.querySelectorAll('li'), (item) => item.textContent);
      await expect(items).toEqual([...STEPS]);
    });

    await step('Space closes it again', async () => {
      await userEvent.keyboard(' ');
      await waitFor(() => expect(list).not.toBeVisible());
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    });
  },
};

export const NothingToPressWhenNothingCanChange: Story = {
  name: '🧪 Enabled and unavailable: no action',
  render: () => (
    <>
      <NotificationStatusNotice status="enabled" title="Notificações ligadas." dataTestId="on" />
      <NotificationStatusNotice
        status="unavailable"
        title="Não dá para ligar notificações neste navegador."
        dataTestId="off"
      />
    </>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('on')).toHaveAttribute('data-status', 'enabled');
    await expect(canvas.getByTestId('off')).toHaveAttribute('data-status', 'unavailable');
    await waitFor(() => expect(canvas.queryByRole('button')).toBeNull());
  },
};

export const PendingCannotBePressedTwice: Story = {
  name: '🧪 Disabled + pending: the action is locked',
  args: {
    status: 'disabled',
    title: 'Suas notificações estão desligadas.',
    enableLabel: 'Ligar notificações',
    onEnable: fn(),
    pending: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('notification-status-notice-enable')).toBeDisabled();
  },
};
