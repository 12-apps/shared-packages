import type { PlatformHomologacaoCopy } from './copy';

/**
 * The pt-BR pack for the platform's homologação screens.
 *
 * A NAMED pack, which is how this repo ships a language: a host imports it and
 * passes it by hand, so choosing Portuguese is a line in that host's diff
 * rather than a silence in this package.
 *
 * The English these screens rendered as literals is deliberately NOT what this
 * pack says. Those sentences were written for a developer reading the code;
 * these are written for the operator filling PagBank's form, which is the
 * register the surface is actually in.
 */
const BASE: Omit<PlatformHomologacaoCopy, 'productionEvidence'> = {
  outcome: {
    heading: 'Situação da homologação',
    statusLabel: 'Situação',
    notSubmitted: 'Não enviada',
    protocolLabel: 'Protocolo',
    protocolPlaceholder: 'Protocolo (card do Pipefy / chamado)',
    notesLabel: 'Observações',
    notesPlaceholder: 'Observações (resposta do PagBank, contexto…)',
    save: 'Registrar',
    saved: 'Registro atualizado.',
    statuses: { SUBMITTED: 'Enviada', APPROVED: 'Aprovada', REJECTED: 'Recusada' },
    submittedAt: (when) => `Enviada em ${when}. `,
    decidedAt: (when) => `Decidida em ${when}. `,
    recordedBy: (who) => `Registrado por ${who}.`,
  },
  guide: {
    heading: 'Formulário de homologação — respostas prontas para colar',
    ledeBeforeForm: 'Abra o ',
    formLink: 'formulário oficial de homologação',
    ledeBeforeSupport: ' e preencha com os valores abaixo. Em paralelo, abra um chamado no ',
    supportLink: 'SIP — suporte de integração PagBank',
    ledeBeforeDocs:
      ' citando o 403 ACCESS_DENIED: o que responder primeiro define se o formulário cobre o Connect. Documentação: ',
    docsLink: 'solicitar homologação',
    ledeAfterDocs: '.',
  },
  anexo: {
    heading: 'Anexo de evidências',
    body:
      'O formulário pede as requisições e as respostas das chamadas enviadas às APIs do PagBank. O arquivo é gerado a partir das chamadas reais desta plataforma, com o token redigido.',
    generate: 'Gerar anexo',
    generateFailed: 'Não foi possível gerar o anexo.',
  },
  connect: {
    expectedRedirectHeading: 'Callback que este deploy usa (o valor que precisa estar registrado)',
    consultAgain: 'Consultar de novo',
    noApplication: 'Nenhuma aplicação configurada neste ambiente.',
    redirectMatches: 'O redirect_uri registrado confere com o callback que este deploy usa.',
    redirectDiffers:
      'O redirect_uri registrado no PagBank é diferente do callback que este deploy usa. O fluxo de autorização OAuth falha silenciosamente até o cadastro ser corrigido no PagBank.',
    redirectUnreported:
      'A resposta do PagBank não trouxe redirect_uri, então não foi possível comparar com o callback.',
    fields: {
      name: 'Nome (exibido ao lojista)',
      site: 'Site',
      description: 'Descrição',
      logo: 'Logo',
      redirectUri: 'redirect_uri registrado',
    },
    fieldEmpty: '—',
    redirectNotReported: 'não informado',
    resolvedFrom:
      'A aplicação deste ambiente é resolvida a partir destas variáveis. O client_id e o client_secret são estritos, sem fallback entre ambientes; as demais, como o token, caem para a variável sem sufixo quando a deste ambiente não existe:',
    showConfig: 'Mostrar variáveis de ambiente',
    hideConfig: 'Ocultar variáveis de ambiente',
    extraKeys: 'Outros campos retornados (schema não documentado)',
    environmentLabels: { SANDBOX: 'Sandbox', PRODUCTION: 'Produção' },
    previewHeading: 'Primeiros 5 caracteres de cada variável',
    previewUnset: 'não definida',
    previewInherited: 'não definida — usa o valor da variável sem sufixo:',
    credentialNames: { clientId: 'client_id', clientSecret: 'client_secret', accountToken: 'token da conta' },
    pasted: {
      heading: 'Testar outras credenciais',
      lede:
        'Cole as credenciais de uma aplicação para consultá-la no PagBank antes de alterar as variáveis de ambiente. Os valores são usados só nesta consulta e não são salvos.',
      environment: 'Ambiente',
      submit: 'Consultar com estas credenciais',
      failed: 'Não foi possível consultar com as credenciais coladas.',
      secretNotChecked:
        'O PagBank não verifica o client_secret nesta consulta — só o client_id e o token. Um client_secret errado só aparece na primeira autorização de loja.',
    },
  },
  evidence: {
    heading: 'Evidências para homologação (sandbox)',
    lede: 'Executa os cenários reais no sandbox do PagBank e gera o TXT para o formulário. Nada é cobrado.',
    sellerHeading: 'Lojista de teste',
    sellerConnected: (connectedAt, accountId) =>
      `Conectado${connectedAt ? ` em ${new Date(connectedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}` : ''}` +
      (accountId ? ` · conta ${accountId}` : ''),
    sellerNotConnected:
      'Nenhum lojista de teste conectado. Sem ele, os cenários de Connect, Pix e cartão ficam pendentes no arquivo.',
    sellerReconnect: 'A conexão do lojista de teste precisa ser autorizada de novo.',
    connectHint:
      'Você fará login no sandbox do PagBank com uma conta de vendedor de teste e aprovará o consentimento. Somente sandbox.',
    connect: 'Conectar lojista de teste',
    reconnect: 'Reconectar lojista de teste',
    connectFailed: 'Não foi possível iniciar a conexão do lojista de teste.',
    returnedConnected:
      'Lojista de teste conectado. O callback e a troca do código foram registrados nas evidências.',
    returnedFailed:
      'A conexão do lojista de teste não foi concluída. Tente conectar de novo.',
    generate: 'Gerar arquivo de evidências\u00a0(TXT e JSON)',
    downloadLatest: 'Baixar o último registrado',
    phases: {
      preparing: 'Consultando a aplicação, renovando o token e gerando a chave pública e a sessão 3DS…',
      encrypting: 'Criptografando os cartões de teste e autenticando o cartão de débito (3DS) no navegador…',
      running: 'Criando os pedidos no sandbox — pode levar alguns minutos…',
      downloading: 'Montando o arquivo…',
    },
    steps: {
      label: 'Progresso da geração',
      names: {
        prepare: 'Preparar (aplicação, token, chave pública e sessão 3DS)',
        encrypt: 'Criptografar os cartões e autenticar o débito (3DS)',
        PIX: 'Pix',
        CARD: 'Cartão de crédito',
        DEBIT: 'Débito com 3DS',
        GOOGLE_PAY: 'Google Pay',
        APPLE_PAY: 'Apple Pay',
        file: 'Montar o arquivo',
      },
      walletsInRun: (included, pending) =>
        [
          included.length > 0 ? `Nesta geração: ${included.join(' e ')}.` : 'Nenhuma carteira nesta geração.',
          pending.length > 0 ? `${pending.join(' e ')} ${pending.length === 1 ? 'fica pendente' : 'ficam pendentes'}.` : '',
        ]
          .filter(Boolean)
          .join(' '),
    },
    summary: ({ executed, failed, pending }) =>
      // Non-breaking inside each count, so only the separators may wrap.
      `✓\u00a0${executed}\u00a0${executed === 1 ? 'executado' : 'executados'} · ` +
      `✗\u00a0${failed}\u00a0${failed === 1 ? 'falhou' : 'falharam'} · ` +
      `⧗\u00a0${pending}\u00a0${pending === 1 ? 'pendente' : 'pendentes'}`,
    incomplete:
      'O arquivo lista o que falta na seção Pendências. Não o envie como completo. Notificações que chegarem depois aparecem ao baixar o último registrado.',
    generateFailed: (phase) =>
      `${
        {
          preparing: 'Falhou ao consultar a aplicação e preparar o lojista de teste.',
          encrypting: 'Falhou ao criptografar os cartões de teste ou autenticar o cartão de débito no navegador.',
          running: 'Falhou ao criar os pedidos no sandbox.',
          downloading: 'Falhou ao montar o arquivo.',
        }[phase]
      } Tente de novo; "Baixar o último registrado" ainda traz o que já foi registrado.`,
    wallets: {
      heading: 'Carteiras digitais (antes de gerar)',
      names: { GOOGLE_PAY: 'Google Pay', APPLE_PAY: 'Apple Pay' },
      hint: 'Toque em cada carteira antes de gerar; sem isso, a seção dela fica pendente.',
      googlePayButtonLocale: 'pt',
      applePayButton: 'Pagar com Apple Pay',
      applePaySheetTotal: 'Teste de homologação',
      applePayCannotStart: 'O Apple Pay não está configurado.',
      applePayCannotComplete: 'Não foi possível concluir o Apple Pay.',
      applePayAbsent: {
        NOT_CONFIGURED: 'Apple Pay: aguardando a conta Apple Developer. A seção fica pendente.',
        NOT_AVAILABLE: 'Apple Pay: abra esta tela no Safari de um iPhone ou Mac para testar.',
        MERCHANT_VALIDATION_FAILED: 'Apple Pay: a validação do comerciante não está configurada. A seção fica pendente.',
      },
      googlePayAbsent: 'Google Pay: não configurado para este lojista. A seção fica pendente.',
      ready: (wallet, card) => `${wallet} pronto${card ? ` — ${card}` : ''}. Será usado ao gerar o arquivo.`,
      failed: (wallet) => `O ${wallet} não devolveu o token. Toque de novo para tentar.`,
    },
  },
};

/**
 * The production evidence card (FUT-4198): the sandbox card's lines where
 * they still hold, and production's own wherever money is real.
 */
export const PT_BR_PLATFORM_HOMOLOGACAO_COPY: PlatformHomologacaoCopy = {
  ...BASE,
  productionEvidence: {
    ...BASE.evidence,
    heading: 'Evidências para homologação (produção)',
    lede:
      'Os mesmos cenários na produção do PagBank, com dinheiro real: R$ 1,00 em cada um, estornado logo depois. Nada é cobrado antes do passo 3. O arquivo é separado do de sandbox.',
    sellerHeading: '1. Lojista de produção',
    sellerNotConnected:
      'Nenhum lojista conectado em produção. Conecte a conta PagBank da plataforma para gerar as evidências de produção.',
    sellerReconnect: 'A conexão do lojista de produção precisa ser autorizada de novo.',
    connectHint: 'Você fará login na produção do PagBank com a conta da plataforma e aprovará o consentimento.',
    connect: 'Conectar lojista de produção',
    reconnect: 'Reconectar lojista de produção',
    connectFailed: 'Não foi possível iniciar a conexão do lojista de produção.',
    returnedConnected: 'Lojista de produção conectado. O callback e a troca do código foram registrados nas evidências.',
    returnedFailed: 'A conexão do lojista de produção não foi concluída. Tente conectar de novo.',
    phases: {
      preparing: 'Consultando a aplicação, renovando o token e gerando a chave pública e a sessão 3DS…',
      encrypting: 'Criptografando os cartões e autenticando o cartão de débito (3DS) — siga o desafio do banco se ele aparecer…',
      running: 'Cobrando R$ 1,00 por cenário e estornando — pode levar alguns minutos…',
      downloading: 'Montando o arquivo…',
    },
    generateFailed: (phase) =>
      `${
        {
          preparing: 'Falhou ao consultar a aplicação e preparar o lojista de produção.',
          encrypting: 'Falhou ao criptografar os cartões ou autenticar o cartão de débito no navegador.',
          running: 'Falhou ao criar os pedidos em produção.',
          downloading: 'Falhou ao montar o arquivo.',
        }[phase]
      } Tente de novo; "Baixar o último registrado" ainda traz o que já foi registrado.`,
    wallets: {
      ...BASE.evidence.wallets,
      heading: 'Carteiras digitais',
      hint: 'Toque em cada carteira antes de cobrar; sem isso, a seção dela fica pendente.',
      googlePayAbsent: 'Google Pay: aguardando o acesso de produção aprovado pelo Google. A seção fica pendente.',
      applePaySheetTotal: 'Homologação PagBank',
    },
    stepper: {
      label: 'Passos da homologação em produção',
      connect: 'Conectar lojista',
      data: 'Titular e cartões',
      charge: 'Cobrar e estornar',
      download: 'Baixar o arquivo',
      progress: (step, total, label) => `Passo ${step} de ${total} · ${label}`,
    },
    buyerHeading: '2. Titular e cartões',
    buyerHint: 'Vai nos pedidos e aparece mascarado no arquivo. Preenchido com o último usado neste navegador.',
    fields: {
      name: 'Nome completo',
      taxId: 'CPF ou CNPJ',
      email: 'E-mail',
      phone: 'Celular',
      postalCode: 'CEP',
      street: 'Rua',
      number: 'Número',
      complement: 'Complemento',
      city: 'Cidade',
      regionCode: 'UF',
    },
    cardsHeading: 'Cartões reais — criptografados no navegador; o número nunca chega ao servidor',
    credit: 'Crédito',
    debit: 'Débito (com 3DS)',
    cardFields: { number: 'Número do cartão', expiry: 'MM/AA', securityCode: 'CVV' },
    debitBlankHint: 'Em branco: o débito fica pendente no arquivo.',
    incompleteData: 'Preencha o titular e o cartão de crédito para cobrar.',
    pixBlocksCharge: 'Pague ou pule o Pix antes de cobrar de novo.',
    scenarios: {
      label: 'Cenários desta cobrança',
      names: { credit: 'Crédito', debit: 'Débito (3DS)', pix: 'Pix', googlePay: 'Google Pay', applePay: 'Apple Pay' },
      recorded: 'registrado no arquivo',
      pending: 'pendente',
      pix: {
        AWAITING_PAYMENT: 'aguardando pagamento',
        REFUND_PENDING: 'pago, estornando',
        REFUNDED: 'pago e estornado',
        SKIPPED: 'pulado, pendente',
      },
    },
    charge: '3. Cobrar R$ 1,00 por cenário e estornar',
    confirm: {
      title: 'Cobrar em produção?',
      body: 'Vai cobrar até R$ 5,00 (R$ 1,00 por cenário) nos cartões, no Pix e em cada carteira tocada, e estornar cada um logo em seguida.',
      typeLabel: 'Digite confirmar',
      word: 'confirmar',
      submit: 'Cobrar e estornar',
      cancel: 'Cancelar',
    },
    pix: {
      title: 'Pague o Pix de R$ 1,00',
      hint: 'Pague pelo app do seu banco. Ao confirmar, ele é estornado.',
      expires: (timeLeft) => `Expira em ${timeLeft}`,
      copy: 'Copiar código',
      copied: 'Código copiado',
      skip: 'Pular o Pix',
      check: 'Verificar o Pix',
      qrAlt: 'QR Code do Pix de R$ 1,00',
      paid: 'Pix pago e estornado.',
      skipped: 'Pix pulado: fica pendente no arquivo.',
      refunding: 'Pix pago. Estornando o R$ 1,00…',
    },
    download: '4. Baixar o arquivo de produção (TXT e JSON)',
  },
};
