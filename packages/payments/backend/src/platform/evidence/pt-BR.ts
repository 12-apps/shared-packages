import type { HomologacaoEvidenceCopy } from './types';

/** `1 cenário pendente` / `2 cenários pendentes` — the count and its agreement. */
const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/**
 * The pt-BR pack for the homologação evidence file (FUT-3696) — a NAMED
 * constant the host passes by hand, never a default.
 *
 * This is the pack a host submits with: the file's reader is PagBank's
 * homologação reviewer, whose form is Portuguese. `EN_US_HOMOLOGACAO_EVIDENCE_COPY`
 * is its translation, for an operator who reads English.
 */
export const PT_BR_HOMOLOGACAO_EVIDENCE_COPY: HomologacaoEvidenceCopy = {
  title: 'EVIDÊNCIAS DE HOMOLOGAÇÃO — PAGBANK (API CONNECT E API DE PEDIDOS/ORDERS, PIX E CARTÃO) — SANDBOX',
  statusLabels: { EXECUTED: 'EXECUTADO', FAILED: 'FALHOU', PENDING: 'PENDENTE' },
  sectionTitles: {
    CONNECT: 'Evidências do Connect',
    PIX: 'Evidências de Pix',
    CARD: 'Evidências de cartão',
    DEBIT: 'Cartão de débito (3DS PagBank)',
    GOOGLE_PAY: 'Google Pay (carteira digital)',
    APPLE_PAY: 'Apple Pay (carteira digital)',
  },
  steps: {
    'connect.authorize': {
      scenario: 'Autorização da conta do lojista de teste (login e consentimento no PagBank)',
      expected: 'O lojista de teste faz login no sandbox do PagBank, aprova o consentimento e é redirecionado ao callback com code e state.',
    },
    'connect.callback': {
      scenario: 'Retorno ao callback da integração',
      expected: 'O callback recebe code e state; o state confere com o emitido pela integração para esta autorização.',
    },
    'connect.exchange': {
      scenario: 'Troca do código de autorização por token — POST /oauth2/token',
      expected: 'HTTP 200 com access_token e refresh_token do lojista; os tokens são armazenados cifrados e nunca exibidos.',
    },
    'connect.application': {
      scenario: 'Consulta da aplicação — GET /oauth2/application/{client_id}',
      expected: 'HTTP 200 com os dados da aplicação, incluindo o redirect_uri registrado.',
    },
    'connect.refresh': {
      scenario: 'Renovação do token do lojista — POST /oauth2/refresh',
      expected: 'HTTP 200 ou 201 com novo access_token; o novo par de tokens substitui o anterior.',
    },
    'connect.usage': {
      scenario: 'Uso da autorização do lojista nos pedidos',
      expected: 'Todos os pedidos abaixo são autenticados com o access_token do lojista obtido no Connect, e não com o token da plataforma.',
    },
    'pix.create': {
      scenario: 'Criação de pedido com QR Code Pix — POST /orders',
      expected: 'HTTP 201 com o pedido (ORDE_…) e qr_codes[] com o texto copia-e-cola e os links da imagem. Criar o QR NÃO significa pagamento.',
    },
    'pix.consult': {
      scenario: 'Consulta do pedido Pix — GET /orders/{order_id}',
      expected: 'HTTP 200 com o estado atual do pedido e, após o pagamento, charges[] com a cobrança (CHAR_…).',
    },
    'pix.paid': {
      scenario: 'Confirmação de pagamento Pix no sandbox',
      expected: 'O simulador do sandbox paga pedidos Pix de até R$ 100,00; a consulta retorna a cobrança com status PAID.',
    },
    'pix.webhook': {
      scenario: 'Notificação de pagamento Pix recebida e processada pela integração',
      expected: 'O PagBank envia POST para a notification_url do pedido; a integração verifica a assinatura, armazena o evento e atualiza o status da cobrança.',
    },
    'card.publicKey': {
      scenario: 'Chave pública do lojista para criptografia do cartão — POST /public-keys',
      expected: 'HTTP 200/201 com public_key, gerada com o token do lojista (a chave pública é pública; não é segredo).',
    },
    'card.encrypt': {
      scenario: 'Preparação dos dados do cartão — criptografia no navegador (PagSeguro.encryptCard)',
      expected: 'Os cartões de teste oficiais são criptografados no navegador com a chave pública do lojista; apenas o valor criptografado chega ao servidor.',
    },
    'card.approved': {
      scenario: 'Pedido com cartão de crédito aprovado (autorização com captura) — POST /orders',
      expected: 'HTTP 201 com charges[0].status PAID: a integração autoriza e captura na mesma chamada (capture: true).',
    },
    'card.approvedConsult': {
      scenario: 'Consulta do resultado do cartão aprovado — GET /orders/{order_id}',
      expected: 'HTTP 200 com o pedido e a cobrança em status PAID.',
    },
    'card.declined': {
      scenario: 'Pedido com cartão de crédito recusado — POST /orders',
      expected: 'HTTP 201 com charges[0].status DECLINED e o código/mensagem de recusa em payment_response.',
    },
    'card.cancel': {
      scenario: 'Cancelamento/estorno da cobrança aprovada — POST /charges/{charge_id}/cancel',
      expected: 'HTTP 201 com a cobrança cancelada (status CANCELED).',
    },
    'card.webhook': {
      scenario: 'Notificações de cartão recebidas e processadas pela integração',
      expected: 'O PagBank envia POST para a notification_url dos pedidos de cartão; a integração armazena os eventos e atualiza o status das cobranças.',
    },
    'debit.session': {
      scenario: 'Sessão de autenticação 3DS — POST /checkout-sdk/sessions',
      expected: 'HTTP 200/201 com session e expires_at, gerada no servidor com o token do lojista; o navegador configura o SDK (PagSeguro.setUp) com ela.',
    },
    'debit.authenticate': {
      scenario: 'Autenticação 3DS do cartão de débito (cartão de teste Visa 4000 0000 0000 2701, sem desafio)',
      expected: 'O SDK do PagBank (PagSeguro.authenticate3DS) autentica no navegador o cartão de teste criptografado, no valor de R$ 27,01: status AUTH_FLOW_COMPLETED, AUTHENTICATED, com o id da autenticação.',
    },
    'debit.approved': {
      scenario: 'Pedido com cartão de débito autenticado (DEBIT_CARD) — POST /orders',
      expected: 'HTTP 201 com charges[0].status PAID: payment_method DEBIT_CARD com authentication_method { type: THREEDS, id } da autenticação acima.',
    },
    'debit.consult': {
      scenario: 'Consulta do pedido de débito — GET /orders/{order_id}',
      expected: 'HTTP 200 com o pedido e a cobrança de débito em status PAID.',
    },
    'debit.cancel': {
      scenario: 'Cancelamento do pagamento com débito — POST /charges/{charge_id}/cancel',
      expected: 'HTTP 201 com a cobrança de débito cancelada (status CANCELED).',
    },
    'gpay.token': {
      scenario: 'Token do Google Pay obtido no navegador (ambiente TEST do Google, gateway pagbank)',
      expected:
        'O operador abre a folha do Google Pay (PaymentsClient em TEST; tokenizationSpecification PAYMENT_GATEWAY com gateway pagbank e ' +
        'gatewayMerchantId = conta PagBank do lojista de teste), no valor de R$ 12,00, e escolhe um cartão de teste do Google; o navegador ' +
        'recebe paymentMethodData.tokenizationData.token. Nenhuma requisição da integração ao PagBank neste passo.',
    },
    'gpay.approved': {
      scenario: 'Pedido com Google Pay aprovado (card.wallet GOOGLE_PAY) — POST /orders',
      expected:
        'HTTP 201 com charges[0].status PAID: payment_method CREDIT_CARD com card.wallet { type: GOOGLE_PAY, key } (o token do Google Pay), ' +
        'autorizado e capturado na mesma chamada (capture: true).',
    },
    'gpay.consult': {
      scenario: 'Consulta do pedido Google Pay — GET /orders/{order_id}',
      expected: 'HTTP 200 com o pedido e a cobrança Google Pay em status PAID.',
    },
    'gpay.cancel': {
      scenario: 'Cancelamento do pagamento com Google Pay — POST /charges/{charge_id}/cancel',
      expected: 'HTTP 201 com a cobrança Google Pay cancelada (status CANCELED).',
    },
    'apay.token': {
      scenario: 'Token do Apple Pay obtido no navegador (ApplePaySession com validação do comerciante)',
      expected:
        'O operador abre a folha do Apple Pay no Safari (ApplePaySession versão 3, Visa e Mastercard), no valor de R$ 12,00; a integração ' +
        'valida o comerciante no servidor com a identidade Apple Pay da plataforma e o navegador recebe token.paymentData. Nenhuma ' +
        'requisição da integração ao PagBank neste passo.',
    },
    'apay.approved': {
      scenario: 'Pedido com Apple Pay aprovado (card.wallet APPLE_PAY) — POST /orders',
      expected:
        'HTTP 201 com charges[0].status PAID: payment_method CREDIT_CARD com card.wallet { type: APPLE_PAY, key } (o token.paymentData do ' +
        'Apple Pay), autorizado e capturado na mesma chamada (capture: true).',
    },
    'apay.consult': {
      scenario: 'Consulta do pedido Apple Pay — GET /orders/{order_id}',
      expected: 'HTTP 200 com o pedido e a cobrança Apple Pay em status PAID.',
    },
    'apay.cancel': {
      scenario: 'Cancelamento do pagamento com Apple Pay — POST /charges/{charge_id}/cancel',
      expected: 'HTTP 201 com a cobrança Apple Pay cancelada (status CANCELED).',
    },
  },
  identification: {
    heading: 'Identificação',
    name: 'Nome',
    site: 'Site',
    environment: 'Ambiente',
    testsAt: 'Data e hora dos testes',
    testsAtConnect: 'Connect',
    testsAtRun: 'Pix e cartão',
    situation: ({ executed, failed, pending }) =>
      failed + pending === 0
        ? `todos os ${executed} cenários executados com o resultado esperado`
        : `INCOMPLETO — ${plural(executed, 'executado', 'executados')} · ${plural(failed, 'com falha', 'com falha')} · ` +
          `${plural(pending, 'pendente', 'pendentes')} (ver Pendências)`,
    clientId: 'client_id da aplicação',
    callback: 'Callback (redirect_uri)',
    generatedAt: 'Arquivo gerado em',
    notRun: 'não executado',
  },
  labels: {
    index: 'Índice dos cenários',
    scenario: 'Cenário',
    status: 'Situação',
    time: 'Horário',
    notes: 'Registro',
    request: 'Requisição',
    response: 'Resposta',
    httpStatus: 'Status HTTP',
    noResponse: (error) => `Sem resposta HTTP (falha de rede: ${error})`,
    ids: 'IDs para correlação',
    expected: 'Resultado esperado',
    observed: 'Resultado observado',
    conclusion: 'Conclusão',
    noCalls: 'Nenhuma requisição da integração ao PagBank neste cenário.',
    noCallsPending: 'Não executado — nenhuma requisição registrada.',
  },
  redactionNote:
    'Segurança: Authorization, access_token, refresh_token, client_secret, códigos OAuth, cookies, ' +
    'CVV, número completo e dados criptografados do cartão e o token das carteiras digitais (Google Pay e ' +
    'Apple Pay, card.wallet.key) foram removidos e aparecem como ' +
    '***REDACTED***. Todas as chamadas abaixo foram registradas pelo próprio código da integração no ' +
    'momento em que foram feitas; nenhuma resposta foi escrita à mão. Dados e cartões usados são os ' +
    'de teste oficiais do PagBank.',
  pendencies: {
    heading: '8. Pendências',
    incomplete: (failed, pending) =>
      `ARQUIVO INCOMPLETO: ${plural(pending, 'cenário pendente', 'cenários pendentes')} e ` +
      `${plural(failed, 'com falha', 'com falha')}. Não envie este arquivo como completo.`,
    allExecuted: 'Todos os cenários listados acima foram executados com o resultado esperado.',
    notCovered: [
      'Não coberto por nenhum cenário: bandeiras além de VISA (Mastercard, Amex, Elo, Hiper).',
      'Não testado: parcelamento (os pedidos usam 1 parcela).',
      'Não aplicável: captura posterior (pré-autorização). A integração autoriza e captura na mesma chamada (capture: true).',
      'Não testado: boleto.',
      'Google Pay e Apple Pay: cobertos o pagamento aprovado, a consulta e o cancelamento; a recusa por carteira não é testada.',
      'Notificações recusadas na verificação de assinatura não são armazenadas. Uma notificação ausente pode não ter sido enviada ou ter sido recusada.',
    ],
    noGuarantee:
      'Este arquivo registra apenas o que foi executado e não garante a aprovação da homologação pelo PagBank.',
  },
  outcome: {
    notRun: 'Não executado.',
    asExpected: 'Conforme o esperado.',
    notAsExpected: 'Diferente do esperado — não aprovado.',
    awaitingConsent: (url) => `URL de autorização gerada (${url}); aguardando login e consentimento do lojista.`,
    consentGiven: 'O lojista aprovou o consentimento e o PagBank redirecionou ao callback com o código.',
    consentRefused: (error) => `O PagBank retornou ao callback com error=${error}; o consentimento não foi concedido.`,
    callbackReceived: () => 'Callback recebido com code (removido) e state; o state confere com o emitido.',
    callbackWithoutCode: (error) =>
      `Callback recebido sem code${error ? ` (error=${error})` : ''}; o state confere com o emitido, mas não há código para trocar.`,
    callbackStateMismatch: 'Callback recebido, mas o state não confere com o emitido; a troca do código não foi feita.',
    callError: (detail) => `A chamada falhou: ${detail}`,
    httpAnswered: (status) => `O PagBank respondeu HTTP ${status}.`,
    exchangeStored: (accountId) =>
      `Tokens do lojista recebidos e armazenados cifrados${accountId ? ` (account_id ${accountId})` : ''}.`,
    applicationConsulted: 'Aplicação consultada; o redirect_uri registrado confere com o callback.',
    applicationRedirectMismatch: 'Aplicação consultada, mas o redirect_uri registrado difere do callback da integração.',
    refreshed: 'Token renovado; o novo par substituiu o anterior.',
    refreshRejected: 'O PagBank recusou a renovação; a conexão do lojista precisa ser autorizada de novo.',
    usageSellerToken: (calls, seller, platform) =>
      `${calls === 1 ? 'A chamada' : `As ${calls} chamadas`} de pedidos, chave pública e sessão 3DS ${calls === 1 ? 'foi autenticada' : 'foram autenticadas'} com o token do lojista ` +
      `(impressão digital SHA-256 ${seller}, registrada em cada requisição acima)` +
      (platform ? `, diferente do token da plataforma (${platform}).` : '.'),
    usageOtherToken:
      'Alguma chamada foi autenticada com um token diferente do token atual do lojista — a autorização do lojista não foi comprovada.',
    usageSameAsPlatform: 'O token do lojista é igual ao da plataforma — a autorização do lojista não foi comprovada.',
    usageNotConnected: 'Nenhum lojista de teste conectado no sandbox; conecte-o antes de gerar as evidências.',
    notSandbox: 'A conexão do lojista de teste não é de sandbox; nada foi executado.',
    qrCreated: (orderId) => `QR Code criado no pedido ${orderId}. Isto ainda NÃO é pagamento confirmado.`,
    qrMissing: 'O pedido foi criado sem QR Code.',
    consultStatus: (status, polls) => `Pedido consultado ${plural(polls, 'vez', 'vezes')}; status final ${status}.`,
    paid: 'Pagamento confirmado: a cobrança Pix está PAID na consulta.',
    notPaidYet: (seconds) => `Pagamento não confirmado em ${seconds} s de consultas.`,
    publicKeyMinted: 'Chave pública gerada com o token do lojista.',
    publicKeyMissing: 'A chave pública não foi gerada.',
    encrypted: (cards) => `Cartões criptografados no navegador: ${cards}.`,
    encryptFailed: (detail) => `Criptografia do cartão no navegador não concluída${detail ? `: ${detail}` : ''}.`,
    browserFailures: {
      SDK_UNAVAILABLE: 'o SDK do PagBank não carregou no navegador',
      NOT_PROCESSED: 'o SDK do PagBank não criptografou o cartão',
      NO_PUBLIC_KEY: 'sem chave pública do lojista',
      NO_THREEDS_SESSION: 'sem sessão 3DS do lojista',
      THREEDS_NOT_SUPPORTED: 'o PagBank informou que o cartão não suporta autenticação 3DS (AUTH_NOT_SUPPORTED)',
      THREEDS_REFUSED: 'o PagBank recusou a autenticação 3DS (CHANGE_PAYMENT_METHOD)',
      THREEDS_FAILED: 'a autenticação 3DS no navegador não foi concluída',
    },
    chargeStatus: (status) => `Cobrança com status ${status}.`,
    canceled: (status) => `Cancelamento registrado com status ${status}.`,
    threeDSSessionMinted: 'Sessão 3DS gerada com o token do lojista.',
    threeDSSessionMissing: 'A sessão 3DS não foi gerada.',
    threeDSAuthenticated: (authenticated) =>
      authenticated
        ? 'Autenticação 3DS concluída no navegador: AUTHENTICATED, sem desafio.'
        : 'Autenticação 3DS concluída no navegador, mas o portador não foi autenticado (NOT_AUTHENTICATED).',
    threeDSFailed: (detail) => `Autenticação 3DS do cartão de débito não concluída${detail ? `: ${detail}` : ''}; nenhum débito foi cobrado.`,
    debitNotReported: 'O navegador não informou o cartão de débito; nenhum débito foi cobrado.',
    walletNames: { GOOGLE_PAY: 'Google Pay', APPLE_PAY: 'Apple Pay' },
    walletTokenReceived: (wallet, card) =>
      `Token do ${wallet} recebido no navegador${card ? ` (${card})` : ''}; ele seguiu apenas para o servidor e aparece como ***REDACTED***.`,
    walletNotRun: (wallet) =>
      `Não executado: o botão do ${wallet} não foi acionado antes de gerar o arquivo; nenhum pedido ${wallet} foi criado.`,
    walletFailed: (wallet, detail) =>
      `Token do ${wallet} não obtido no navegador${detail ? `: ${detail}` : ''}; nenhum pedido ${wallet} foi criado.`,
    walletFailures: {
      NOT_AVAILABLE: 'a carteira não é oferecida neste navegador/dispositivo',
      DISMISSED: 'a folha de pagamento foi fechada pelo operador',
      NOT_CONFIGURED: 'aguardando a conta Apple Developer — identidade Apple Pay não configurada',
      MERCHANT_VALIDATION_FAILED: 'a validação do comerciante Apple Pay não foi concluída',
      TOKEN_ERROR: 'a folha de pagamento falhou ou não devolveu o token',
    },
    applePayNotConfigured:
      'Pendente: aguardando a conta Apple Developer — identidade Apple Pay não configurada (Merchant ID e certificado). ' +
      'Nenhum pedido Apple Pay foi criado.',
    webhookReceived: (count, statuses, chargeStatus) =>
      (count === 1 ? '1 notificação recebida e armazenada' : `${count} notificações recebidas e armazenadas`) + ` (situação: ${statuses})` +
      (chargeStatus ? `; a cobrança registrada pela integração está ${chargeStatus}.` : '.'),
    webhookNone: 'Nenhuma notificação recebida até a geração deste arquivo.',
    webhookFailed: 'Notificação recebida, mas o processamento falhou.',
    webhookNotProcessed: (statuses, chargeStatus) =>
      `Notificação recebida, mas ainda não processada (situação: ${statuses}` +
      (chargeStatus ? `; cobrança ${chargeStatus})` : ')') + '.',
    enableFailed: (detail) =>
      `Tokens recebidos e armazenados, mas o lojista não pôde ser habilitado para os pedidos: ${detail}`,
  },
};
