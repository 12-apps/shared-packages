import type {
  InfinitePaySetupGuideCopy,
  StoneSetupGuideCopy,
  StripeSetupGuideCopy,
} from './setup-guide-copy';

/**
 * The pt-BR walkthroughs for the adapters that ship one — NAMED constants a
 * host passes by hand, never a default.
 *
 * The filename is what exempts this file from the copy-portability gate:
 * Portuguese may ship, it may not be silent. Every sentence is VERBATIM what
 * the guide used to render, so a host adopting these sees the same screen —
 * what changes is that the words are now chosen in a diff.
 *
 * Kept apart from `pt-BR.ts` because these are the longest strings in the
 * package by an order of magnitude, and a translator working on a walkthrough
 * is doing a different job from one naming a credential field.
 */
export const PT_BR_STRIPE_SETUP_GUIDE_COPY: StripeSetupGuideCopy = {
  stages: {
    connectOauth: 'Conectar conta',
    connectCredentials: 'Informar as chaves',
    dashboard: 'Configurar na Stripe',
    activate: 'Ativar vendas',
  },
  connect: {
    title: 'Passo 1 · Conectar sua conta Stripe',
    intro:
      'A conexão é feita por autorização no site da Stripe — você não precisa copiar nenhuma chave, e pode revogar o acesso quando quiser, pelo painel da Stripe ou pelo botão “Desconectar” aqui. Prefere usar as suas próprias chaves? Abra “Prefiro informar as credenciais manualmente” abaixo: o passo a passo muda para esse caminho.',
    authorize:
      'Clique em “Conectar com Stripe” acima. Você será levado ao site da Stripe para entrar na sua conta e autorizar o acesso. Se ainda não tiver conta, dá para criar uma durante o processo.',
    aboutConnect: 'Sobre o Stripe Connect',
    returns:
      'Ao autorizar, você volta automaticamente para esta página e a conexão aparece como “Conectado”.',
  },
  credentials: {
    title: 'Passo 1 · Informar as suas chaves da Stripe',
    intro:
      'Você está conectando com as **suas próprias chaves**. Elas ficam guardadas nesta loja, e o ambiente escolhido acima (Sandbox ou Produção) decide de qual conta da Stripe elas têm de vir — as chaves de teste não funcionam em produção.',
    keys: 'No painel da Stripe, abra “Desenvolvedores › Chaves de API” e copie a **Secret key** (`sk_...`) e a **Publishable key** (`pk_...`).',
    keysButton: 'Abrir chaves de API',
    webhook:
      'Em “Desenvolvedores › Webhooks”, crie um endpoint apontando para a URL de notificação desta loja e copie o **Signing secret** (`whsec_...`) que a Stripe mostra ao criá-lo. Sem ele, um pagamento aprovado não é confirmado aqui.',
    save: 'Cole as chaves no formulário abaixo e clique em “Salvar e testar conexão”. Elas são enviadas à Stripe na hora, e o resultado de cada uma aparece logo em seguida.',
  },
  dashboard: {
    title: 'Passo 2 · Configurar sua conta na Stripe',
    doneLabel: 'Conta Stripe',
    doneValue: 'Configurada por você',
    intro:
      'A Stripe só processa PIX e boleto se esses meios estiverem habilitados na **sua própria** conta — a autorização não liga isso por você.',
    methods:
      'No painel da Stripe, abra “Configurações › Métodos de pagamento” e ative PIX e Boleto para a sua conta brasileira.',
    methodsButton: 'Abrir métodos de pagamento',
    tokenization:
      'Abra “Configurações › Integração” e ative a tokenização de cartão com chave publicável. Contas novas vêm com isso desligado, e sem ele a Stripe recusa a cobrança de teste do Passo 3 com “integration surface is unsupported”.',
    tokenizationButton: 'Abrir configurações de integração',
    payoutsEnabled:
      'Confirme que sua conta está habilitada para receber pagamentos — a Stripe pede documentos da empresa antes de liberar repasses.',
    dashboardButton: 'Abrir o painel da Stripe',
    webhook: (viaGrant) =>
      viaGrant
        ? 'A URL de notificação desta loja é a de baixo. Conectando por autorização ela já vem configurada — copie-a apenas se preferir cadastrar um endpoint próprio em “Desenvolvedores › Webhooks”.'
        : 'Confira que o endpoint criado em “Desenvolvedores › Webhooks” aponta para a URL de notificação desta loja, abaixo. Com as suas próprias chaves, este cadastro é seu — sem ele a Stripe não avisa esta loja quando um pagamento é aprovado.',
    confirmLabel: 'Já configurei minha conta na Stripe',
  },
  webhookUrlLabel: 'URL de notificação',
};

export const PT_BR_STONE_SETUP_GUIDE_COPY: StoneSetupGuideCopy = {
  stages: { keys: 'Gerar chaves', webhook: 'Cadastrar webhook', activate: 'Ativar vendas' },
  keys: {
    title: 'Gerar suas chaves de API',
    intro:
      'A Stone processa pagamentos online pela plataforma Pagar.me (tecnologia da própria Stone) — por isso as chaves são geradas no painel do Pagar.me, com a mesma conta Stone.',
    generate:
      'Abra o painel e vá em “Configurações › Chaves”. Copie a chave pública (pk_...) e gere a chave secreta (sk_...).',
    dashboardButton: 'Abrir o painel',
    paste:
      'Cole as duas chaves no formulário acima. Use as chaves de teste enquanto estiver no ambiente Sandbox e as de produção só depois de validar.',
    authDocsLink: 'Documentação de autenticação',
  },
  webhook: {
    title: 'Cadastrar a URL de notificação',
    intro:
      'Sem webhook, um PIX pago só é detectado quando a tela consulta o status — o pedido pode demorar a confirmar.',
    register: 'No painel, abra “Configurações › Webhooks” e cadastre a URL desta loja:',
    credentials: (brandName) =>
      `Ao cadastrar, o painel pede um usuário e uma senha para autenticar as notificações. Defina os dois e informe exatamente os mesmos valores no formulário acima — é assim que ${brandName} confirma que a notificação veio mesmo da Stone.`,
    events:
      'Assine ao menos os eventos de cobrança: charge.paid, charge.payment_failed e charge.refunded.',
    testConnection:
      'Feito isso, clique em “Testar conexão” acima: o teste faz uma chamada autenticada real e avisa se a chave estiver errada.',
    doneLabel: 'Webhook',
    doneValue: 'Cadastrado no painel Pagar.me',
    confirmLabel: 'Já cadastrei a URL no painel',
  },
  webhookUrlLabel: 'URL de notificação',
};

export const PT_BR_INFINITEPAY_SETUP_GUIDE_COPY: InfinitePaySetupGuideCopy = {
  stages: {
    handle: 'Informar InfiniteTag',
    enable: 'Habilitar o Checkout',
    activate: 'Ativar vendas',
  },
  handle: {
    title: 'Passo 1 · Informe sua InfiniteTag',
    intro:
      'A InfinitePay identifica sua conta pela InfiniteTag — o mesmo @ que aparece no topo do app. Não há chave de API para copiar.',
    doNotChange:
      'A página da InfinitePay também permite **alterar** a tag — não altere. Mudar a InfiniteTag quebra suas cobranças, sua Loja Online e os links de pagamento já enviados, que precisam ser reemitidos.',
    wrongTagPaysAStranger: (brandName) =>
      `A InfiniteTag define para **qual conta** o dinheiro vai. Uma tag errada envia os pagamentos desta loja para outra pessoa, e não há como reverter por ${brandName} — confira caractere por caractere.`,
    seeMyTagButton: 'Ver a minha InfiniteTag',
  },
  enable: {
    title: 'Passo 2 · Habilite o Checkout Integrado',
    intro:
      'Em contas InfinitePay o Checkout Integrado vem **desligado**. Sem ele nenhum link de pagamento é criado — mesmo com a InfiniteTag certa.',
    enableStep:
      'No app InfinitePay: **Vendas › Checkout › Configurações › Habilitar Checkout Integrado**.',
    settingsButton: 'Abrir as configurações do checkout',
    doneLabel: 'Checkout Integrado',
    doneValue: 'Habilitado na conta InfinitePay',
    webhookUrlLabel: 'URL de notificação (você não precisa cadastrar)',
  },
};
