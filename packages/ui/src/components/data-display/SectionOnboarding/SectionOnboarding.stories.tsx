import CreditCard from '@mui/icons-material/CreditCard';
import { Box, Chip, SvgIcon, TextField, Typography } from '@mui/material';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { SectionOnboarding } from './SectionOnboarding';

const PaymentIllustration = () => (
  <SvgIcon sx={{ fontSize: 72, color: 'primary.main' }}>
    <CreditCard />
  </SvgIcon>
);

/** Stand-in for the real credential form the section wraps. */
const MockForm = () => (
  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 480 }}>
    <TextField label="Token do PagBank" type="password" fullWidth size="small" />
    <TextField label="Chave pública do cartão (opcional)" fullWidth size="small" />
  </Box>
);

const SETUP_STEPS = [
  { id: 'connect', label: 'Conectar conta' },
  { id: 'homolog', label: 'Homologar' },
  { id: 'activate', label: 'Ativar vendas' },
];

const meta: Meta<typeof SectionOnboarding> = {
  title: 'Feedback/AsyncStates/SectionOnboarding',
  component: SectionOnboarding,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Per-section onboarding wrapper: one config surface renders three ways ' +
          '(unconfigured hero → in-progress steps + form → configured summary) so ' +
          'first-time users meet a friendly CTA instead of a wall of empty fields. ' +
          'Composes EmptyState + Stepper.',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    status: {
      control: { type: 'select' },
      options: ['unconfigured', 'in-progress', 'configured'],
    },
    children: { control: false },
    illustration: { control: false },
    configuredSummary: { control: false },
    steps: { control: false },
    primaryAction: { control: false },
    secondaryAction: { control: false },
    helpLink: { control: false },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Unconfigured: Story = {
  args: {
    status: 'unconfigured',
    title: 'Receba pagamentos na sua loja',
    description:
      'Conecte sua conta PagBank para vender por PIX e cartão de crédito. Leva alguns minutos e você só ativa quando estiver tudo pronto.',
    illustration: <PaymentIllustration />,
    steps: SETUP_STEPS,
    primaryAction: { label: 'Começar configuração', onClick: fn() },
    secondaryAction: { label: 'Ver como funciona', onClick: fn() },
    helpLink: { label: 'Dúvidas? Fale com o suporte', href: '#', external: true },
  },
};

export const UnconfiguredNoSteps: Story = {
  args: {
    status: 'unconfigured',
    title: 'Configure a integração com IA',
    description: 'Deixe a IA responder perguntas do seu cardápio automaticamente.',
    primaryAction: { label: 'Começar', onClick: fn() },
  },
};

export const InProgress: Story = {
  args: {
    status: 'in-progress',
    title: 'Conectar conta PagBank',
    steps: SETUP_STEPS,
    activeStepId: 'connect',
    completedStepIds: [],
    children: <MockForm />,
  },
};

export const InProgressSecondStep: Story = {
  args: {
    status: 'in-progress',
    title: 'Homologação',
    steps: SETUP_STEPS,
    activeStepId: 'homolog',
    completedStepIds: ['connect'],
    children: <MockForm />,
  },
};

export const Configured: Story = {
  args: {
    status: 'configured',
    title: 'PagBank',
    configuredTitle: 'PagBank conectado',
    configuredSummary: (
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 0.5 }}>
        <Chip label="Ativo" color="success" size="sm" />
        <Typography variant="body2" color="text.secondary">
          Ambiente: Produção
        </Typography>
      </Box>
    ),
    children: <MockForm />,
  },
};

export const ConfiguredExpanded: Story = {
  args: {
    ...Configured.args,
    defaultExpanded: true,
  },
};

export const AllStates: Story = {
  render: () => (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <SectionOnboarding
        status="unconfigured"
        title="Receba pagamentos na sua loja"
        description="Conecte sua conta PagBank para vender por PIX e cartão."
        illustration={<PaymentIllustration />}
        steps={SETUP_STEPS}
        primaryAction={{ label: 'Começar configuração', onClick: fn() }}
      />
      <SectionOnboarding
        status="in-progress"
        title="Conectar conta PagBank"
        steps={SETUP_STEPS}
        activeStepId="connect"
      >
        <MockForm />
      </SectionOnboarding>
      <SectionOnboarding
        status="configured"
        title="PagBank"
        configuredTitle="PagBank conectado"
        configuredSummary={<Chip label="Ativo — Produção" color="success" size="sm" />}
      >
        <MockForm />
      </SectionOnboarding>
    </Box>
  ),
};
