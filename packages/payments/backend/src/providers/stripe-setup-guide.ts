import type { ProviderSetupGuide, SetupGuideContext, SetupProgress } from '../core/types';

/**
 * Stripe's onboarding walkthrough.
 *
 * Shorter than Stone's on purpose: an OAuth store does not copy a single
 * key. The steps that remain are the ones authorization cannot do for them —
 * enabling the Brazilian payment methods on their own account, knowing where
 * the money lands, and switching the store on.
 *
 * Stages and sections pair 1:1, Stone-style, and that pairing is load-bearing:
 * the renderer shows ONE section, the one whose id matches the stage the store
 * is on (`SetupGuideSection.sectionAt`). This guide used to declare a
 * `webhook` section no stage pointed at — the store's notification URL and its
 * copy button were unreachable from any state — while the `activate` stage
 * resolved to no section at all (FUT-691).
 */
export function stripeSetupGuide(ctx: SetupGuideContext): ProviderSetupGuide {
  const stages = [
    { id: 'connect', label: 'Conectar conta' },
    { id: 'methods', label: 'Habilitar meios' },
    { id: 'webhook', label: 'Notificações' },
    { id: 'activate', label: 'Ativar vendas' },
  ];
  const sections = [connectSection(), methodsSection(), webhookSection(ctx), activateSection()];
  // With no `progress` from the host the whole guide is returned, unchanged: a
  // caller that cannot say what is done must not be shown a guide that has
  // decided for them (same contract as InfinitePay's).
  if (!ctx.progress) return { stages, sections };
  return { stages, sections, activeStage: activeStageOf(ctx.progress, stages.length) };
}

/**
 * Which numbered step the stepper should sit on, from the two facts the server
 * can prove: the authorization reached an account (`connected`), and a real
 * charge landed (`proven`).
 *
 * The two dashboard stages in the middle — payment methods and the webhook —
 * happen on Stripe's own screens, and no API this adapter calls can tell them
 * apart. Holding at `methods` would stall the walkthrough with no fact that
 * ever advances it, so a connected store sits on the WEBHOOK stage: the one
 * section carrying a per-store fact (the notification URL) and the pointer to
 * "Testar conexão". Before this the guide returned no `activeStage` at all, so
 * the stepper sat on "Conectar conta" forever, over a store that had already
 * connected (FUT-691).
 */
function activeStageOf(progress: SetupProgress, stageCount: number): number {
  if (!progress.connected) return 0;
  return progress.proven ? stageCount : 2;
}

function connectSection(): ProviderSetupGuide['sections'][number] {
  return {
    id: 'connect',
    title: 'Conectar sua conta Stripe',
    intro:
      'A conexão é feita por autorização no site da Stripe. Você não precisa copiar nenhuma chave — e pode revogar o acesso quando quiser, pelo painel da Stripe ou pelo botão “Desconectar” aqui.',
    steps: [
      {
        text: 'Clique em “Conectar com Stripe” acima. Você será levado ao site da Stripe para entrar na sua conta e autorizar o acesso. Se ainda não tiver conta, dá para criar uma durante o processo.',
        link: {
          label: 'Sobre o Stripe Connect',
          url: 'https://stripe.com/docs/connect',
        },
      },
      {
        text: 'Ao autorizar, você volta automaticamente para esta página e a conexão aparece como “Conectado”.',
      },
    ],
  };
}

function methodsSection(): ProviderSetupGuide['sections'][number] {
  return {
    id: 'methods',
    title: 'Habilitar PIX e boleto na sua conta',
    intro:
      'A Stripe só processa PIX e boleto se esses meios estiverem habilitados na sua própria conta — a autorização não liga isso por você.',
    steps: [
      {
        text: 'No painel da Stripe, abra “Configurações › Métodos de pagamento” e ative PIX e Boleto para a sua conta brasileira.',
        button: {
          label: 'Abrir métodos de pagamento',
          url: 'https://dashboard.stripe.com/settings/payment_methods',
        },
      },
      {
        text: 'Confirme que sua conta está habilitada para receber pagamentos (a Stripe pede documentos da empresa antes de liberar repasses).',
        button: {
          label: 'Abrir o painel da Stripe',
          url: 'https://dashboard.stripe.com',
        },
      },
    ],
  };
}

function webhookSection(ctx: SetupGuideContext): ProviderSetupGuide['sections'][number] {
  return {
    id: 'webhook',
    title: 'Notificações de pagamento',
    intro:
      'As confirmações de pagamento chegam por webhook. Nas contas conectadas por autorização isso já vem configurado — a URL abaixo é informativa, útil se você preferir cadastrar um endpoint próprio.',
    steps: [
      {
        text: 'URL de notificação desta loja:',
        copy: { label: 'URL de notificação', text: ctx.webhookUrl },
      },
    ],
  };
}

/**
 * The activate stage carries its own section for now. InfinitePay leaves its
 * last stage sectionless because the HOST's verification card takes that slot;
 * Stripe declares no `activationCharge` capability yet, so a sectionless stage
 * here would render nothing at all where the closing instructions belong.
 */
function activateSection(): ProviderSetupGuide['sections'][number] {
  return {
    id: 'activate',
    title: 'Validar e ativar',
    steps: [
      {
        text: 'Depois de conectar, use “Testar conexão” para confirmar que o Future Pay consegue falar com a sua conta.',
      },
      {
        text: 'Com o teste OK, ligue a chave “Ativo” para começar a receber por esta conta.',
      },
    ],
  };
}
