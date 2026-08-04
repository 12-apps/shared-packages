import type { ProviderSetupGuide, SetupGuideContext } from '../core/types';

/**
 * Stripe's onboarding walkthrough.
 *
 * Shorter than PagBank's on purpose: an OAuth store does not copy a single
 * key. The steps that remain are the ones authorization cannot do for them —
 * enabling the Brazilian payment methods on their own account, and knowing
 * where the money lands.
 */
export function stripeSetupGuide(ctx: SetupGuideContext): ProviderSetupGuide {
  return {
    stages: [
      { id: 'connect', label: 'Conectar conta' },
      { id: 'methods', label: 'Habilitar meios' },
      { id: 'activate', label: 'Ativar vendas' },
    ],
    sections: [
      {
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
      },
      {
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
      },
      {
        id: 'webhook',
        title: 'Notificações de pagamento',
        intro:
          'As confirmações de pagamento chegam por webhook. Nas contas conectadas por autorização isso já vem configurado — a URL abaixo é informativa, útil se você preferir cadastrar um endpoint próprio.',
        steps: [
          {
            text: 'URL de notificação desta loja:',
            copy: { label: 'URL de notificação', text: ctx.webhookUrl },
          },
          {
            text: 'Depois de conectar, use “Testar conexão” para confirmar que o Future Pay consegue falar com a sua conta.',
          },
        ],
      },
    ],
  };
}
