import type { Meta, StoryObj } from '@storybook/react-vite';
import Stack from '@mui/material/Stack/index.js';
import { fn } from 'storybook/test';

import { PT_BR_NOTIFICATION_UNBLOCK_COPY } from '../../../pt-BR';

import { NotificationStatusNotice } from './NotificationStatusNotice';
import { notificationUnblockSteps } from './NotificationStatusNotice.helpers';

/**
 * Every sentence here is the host's — this package ships no default words — so
 * the stories pass pt-BR copy exactly as a host does. The unblock steps come
 * from the package's own pack, through `notificationUnblockSteps`.
 */
const CHROME_DESKTOP_STEPS = notificationUnblockSteps(PT_BR_NOTIFICATION_UNBLOCK_COPY, {
  family: 'chrome',
  platform: 'desktop',
});

const meta: Meta<typeof NotificationStatusNotice> = {
  title: 'Feedback/NotificationStatusNotice',
  component: NotificationStatusNotice,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          "Tells a reader whether this browser will notify them, and offers the one thing they can do about it: a tap that asks for permission, the steps that undo a browser's refusal, or nothing when nothing can change.",
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Disabled: Story = {
  args: {
    status: 'disabled',
    title: 'Suas notificações estão desligadas.',
    description: 'Sem elas, a gente não consegue te avisar no celular quando a mesa liberar.',
    enableLabel: 'Ligar notificações',
    onEnable: fn(),
  },
};

export const Pending: Story = {
  args: { ...Disabled.args, pending: true } as Story['args'],
};

export const Enabled: Story = {
  args: {
    status: 'enabled',
    title: 'Notificações ligadas.',
    description: 'A gente te avisa neste aparelho quando a mesa liberar.',
  },
};

export const Blocked: Story = {
  args: {
    status: 'blocked',
    title: 'As notificações estão bloqueadas neste navegador.',
    description: 'Só você consegue liberar, nas configurações do navegador.',
    stepsToggleLabel: 'Habilitar novamente',
    steps: CHROME_DESKTOP_STEPS,
  },
};

export const BlockedStepsOpen: Story = {
  args: { ...Blocked.args, defaultStepsOpen: true } as Story['args'],
};

export const BlockedOnIphone: Story = {
  args: {
    ...Blocked.args,
    steps: PT_BR_NOTIFICATION_UNBLOCK_COPY.ios,
    defaultStepsOpen: true,
  } as Story['args'],
};

export const Unavailable: Story = {
  args: {
    status: 'unavailable',
    title: 'Não dá para ligar notificações neste navegador.',
    description: 'Não vamos te avisar no celular. Fique de olho nesta tela ou no seu e-mail.',
  },
};

export const LongText: Story = {
  args: {
    status: 'disabled',
    title:
      'Suas notificações estão desligadas, e sem elas a gente não tem como te chamar quando a sua vez chegar na fila de espera.',
    description:
      'Ligue agora para receber o aviso mesmo com o celular no bolso — a gente só manda o que for sobre a sua mesa.',
    enableLabel: 'Ligar notificações neste aparelho',
    onEnable: fn(),
  },
};

export const AllStatuses: Story = {
  render: () => (
    <Stack spacing={2}>
      <NotificationStatusNotice {...(Enabled.args as never)} dataTestId="enabled" />
      <NotificationStatusNotice {...(Disabled.args as never)} dataTestId="disabled" />
      <NotificationStatusNotice {...(Blocked.args as never)} dataTestId="blocked" />
      <NotificationStatusNotice {...(Unavailable.args as never)} dataTestId="unavailable" />
    </Stack>
  ),
};
