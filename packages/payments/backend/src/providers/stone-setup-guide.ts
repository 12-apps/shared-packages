import type { ProviderSetupGuide, SetupGuideContext } from '../core/types';

/**
 * Stone's onboarding walkthrough.
 *
 * Longer than Stripe's because Stone has no authorization flow: the store
 * really does have to generate a key pair and register a webhook by hand. The
 * dashboard is Pagar.me's — Stone's payments technology — which surprises
 * store owners, so the copy says so up front.
 */
export function stoneSetupGuide(ctx: SetupGuideContext): ProviderSetupGuide {
  return {
    stages: [
      { id: 'keys', label: 'Gerar chaves' },
      { id: 'webhook', label: 'Cadastrar webhook' },
      { id: 'activate', label: 'Ativar vendas' },
    ],
    sections: [
      {
        id: 'keys',
        title: 'Gerar suas chaves de API',
        intro:
          'A Stone processa pagamentos online pela plataforma Pagar.me (tecnologia da própria Stone) — por isso as chaves são geradas no painel do Pagar.me, com a mesma conta Stone.',
        steps: [
          {
            text: 'Abra o painel e vá em “Configurações › Chaves”. Copie a chave pública (pk_...) e gere a chave secreta (sk_...).',
            button: { label: 'Abrir o painel', url: 'https://dash.pagar.me' },
          },
          {
            text: 'Cole as duas chaves no formulário acima. Use as chaves de teste enquanto estiver no ambiente Sandbox e as de produção só depois de validar.',
            link: {
              label: 'Documentação de autenticação',
              url: 'https://docs.pagar.me/reference/autentica%C3%A7%C3%A3o-2',
            },
          },
        ],
      },
      {
        id: 'webhook',
        title: 'Cadastrar a URL de notificação',
        intro:
          'Sem webhook, um PIX pago só é detectado quando a tela consulta o status — o pedido pode demorar a confirmar.',
        steps: [
          {
            text: 'No painel, abra “Configurações › Webhooks” e cadastre a URL desta loja:',
            copy: { label: 'URL de notificação', text: ctx.webhookUrl },
          },
          {
            text: 'Ao cadastrar, o painel pede um usuário e uma senha para autenticar as notificações. Defina os dois e informe exatamente os mesmos valores no formulário acima — é assim que o Future Pay confirma que a notificação veio mesmo da Stone.',
          },
          {
            text: 'Assine ao menos os eventos de cobrança: charge.paid, charge.payment_failed e charge.refunded.',
          },
        ],
      },
      {
        id: 'activate',
        title: 'Validar e ativar',
        steps: [
          {
            text: 'Clique em “Testar conexão” acima. O teste faz uma chamada autenticada real — se a chave estiver errada, ele avisa.',
          },
          {
            text: 'Com o teste OK, ligue a chave “Ativo” para começar a receber por esta conta.',
          },
        ],
      },
    ],
  };
}
