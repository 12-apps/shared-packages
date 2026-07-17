import { Box, Chip, TextField } from '@mui/material';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { SectionOnboarding } from './SectionOnboarding';

const MockForm = () => (
  <TextField label="Token do PagBank" type="password" data-testid="mock-form-field" />
);

const SETUP_STEPS = [
  { id: 'connect', label: 'Conectar conta' },
  { id: 'homolog', label: 'Homologar' },
  { id: 'activate', label: 'Ativar vendas' },
];

const meta: Meta<typeof SectionOnboarding> = {
  title: 'DataDisplay/AsyncStates/SectionOnboarding/Tests',
  component: SectionOnboarding,
  parameters: {
    layout: 'padded',
    chromatic: { disableSnapshot: false },
  },
  tags: ['autodocs', 'test', 'component:SectionOnboarding'],
};

export default meta;
export type Story = StoryObj<typeof meta>;

export const UnconfiguredShowsHeroAndCta: Story = {
  args: {
    status: 'unconfigured',
    title: 'Receba pagamentos',
    description: 'Conecte sua conta PagBank.',
    steps: SETUP_STEPS,
    primaryAction: { label: 'Começar configuração', onClick: fn() },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);

    // Root reflects the status.
    const root = canvas.getByTestId('section-onboarding');
    await expect(root).toHaveAttribute('data-status', 'unconfigured');

    // Hero title + step preview are present.
    await expect(canvas.getByRole('heading', { name: 'Receba pagamentos' })).toBeInTheDocument();
    await expect(canvas.getByTestId('section-onboarding-steps')).toBeInTheDocument();

    // CTA fires.
    const cta = canvas.getByRole('button', { name: 'Começar configuração' });
    await userEvent.click(cta);
    await expect(args.primaryAction?.onClick).toHaveBeenCalledTimes(1);

    // The real form is NOT rendered before setup starts.
    await waitFor(() => expect(canvas.queryByTestId('mock-form-field')).not.toBeInTheDocument());
  },
};

export const InProgressShowsStepsAndForm: Story = {
  args: {
    status: 'in-progress',
    title: 'Conectar conta',
    steps: SETUP_STEPS,
    activeStepId: 'homolog',
    completedStepIds: ['connect'],
    children: <MockForm />,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const root = canvas.getByTestId('section-onboarding');
    await expect(root).toHaveAttribute('data-status', 'in-progress');

    // Steps AND the form are both visible during active setup.
    await expect(canvas.getByTestId('section-onboarding-steps')).toBeInTheDocument();
    await expect(canvas.getByTestId('mock-form-field')).toBeInTheDocument();
  },
};

export const ConfiguredCollapsesFormBehindToggle: Story = {
  args: {
    status: 'configured',
    title: 'PagBank',
    configuredTitle: 'PagBank conectado',
    configuredSummary: <Chip label="Ativo" color="success" size="small" />,
    children: <MockForm />,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const root = canvas.getByTestId('section-onboarding');
    await expect(root).toHaveAttribute('data-status', 'configured');

    // Compact summary is shown; the form starts hidden.
    await expect(canvas.getByText('PagBank conectado')).toBeInTheDocument();
    await waitFor(() => expect(canvas.queryByTestId('mock-form-field')).not.toBeInTheDocument());

    // Reveal the form via the edit toggle.
    const toggle = canvas.getByTestId('section-onboarding-edit-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(canvas.getByTestId('mock-form-field')).toBeVisible();
  },
};

export const ConfiguredDefaultExpanded: Story = {
  args: {
    status: 'configured',
    title: 'PagBank',
    configuredSummary: <Chip label="Ativo" color="success" size="small" />,
    defaultExpanded: true,
    children: <MockForm />,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // With defaultExpanded, the form is visible immediately.
    await expect(canvas.getByTestId('mock-form-field')).toBeVisible();
    await expect(canvas.getByTestId('section-onboarding-edit-toggle')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  },
};

export const HeroCtaRevealsFormInPlace: Story = {
  args: {
    status: 'unconfigured',
    title: 'Receba pagamentos',
    description: 'Conecte sua conta PagBank.',
    steps: SETUP_STEPS,
    startLabel: 'Começar configuração',
    children: <MockForm />,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // No custom primaryAction => the built-in start CTA is offered and the
    // form is hidden until the user starts.
    await expect(canvas.getByTestId('section-onboarding')).toHaveAttribute(
      'data-status',
      'unconfigured',
    );
    await waitFor(() => expect(canvas.queryByTestId('mock-form-field')).not.toBeInTheDocument());

    const startCta = canvas.getByRole('button', { name: 'Começar configuração' });
    await userEvent.click(startCta);

    // Now the form is revealed in place — no parent state required.
    await expect(canvas.getByTestId('section-onboarding')).toHaveAttribute('data-status', 'started');
    await expect(canvas.getByTestId('mock-form-field')).toBeVisible();
  },
};

export const NoStepsRendersSingleStepHero: Story = {
  args: {
    status: 'unconfigured',
    title: 'Integração com IA',
    description: 'Deixe a IA responder o seu cardápio.',
    primaryAction: { label: 'Começar', onClick: fn() },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // No steps => no stepper preview, but the hero still renders.
    await waitFor(() =>
      expect(canvas.queryByTestId('section-onboarding-steps')).not.toBeInTheDocument(),
    );
    await expect(canvas.getByRole('heading', { name: 'Integração com IA' })).toBeInTheDocument();
  },
};

export const ConfiguredWithoutChildrenHidesToggle: Story = {
  render: () => (
    <Box>
      <SectionOnboarding
        status="configured"
        title="PagBank"
        configuredSummary={<Chip label="Ativo" color="success" size="small" />}
      />
    </Box>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // No children => no edit toggle offered.
    await waitFor(() =>
      expect(canvas.queryByTestId('section-onboarding-edit-toggle')).not.toBeInTheDocument(),
    );
    await expect(canvas.getByTestId('section-onboarding-summary')).toBeInTheDocument();
  },
};
