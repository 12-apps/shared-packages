import type { PaymentsSettingsCopy } from './settings-copy';

/**
 * The pt-BR pack for the payments settings surface — a NAMED constant a host
 * passes by hand, never a default.
 *
 * The filename is what exempts this file from the copy-portability gate:
 * Portuguese may ship, it may not be silent. Every sentence is VERBATIM what
 * the screen used to render, so a host adopting it sees no change — what
 * changes is that the words are chosen in a diff.
 */
export const PT_BR_PAYMENTS_SETTINGS_COPY: PaymentsSettingsCopy = {
  status: {
    verified: 'VERIFICADO',
    unverified: 'NÃO VERIFICADO',
    connectionOk: 'CONEXÃO OK',
    reconnectRequired: 'RECONECTAR',
    notConnected: 'Não conectado',
    threeStepsAhead: 'Este provedor só passa a receber vendas depois dos 3 passos abaixo.',
    connectAndVerifyFirst: 'Conecte e verifique o provedor antes de ativar as vendas.',
    receiving: {
      state: 'Recebendo vendas',
      sub: 'Sua loja está recebendo por este provedor.',
    },
    pausedByOwner: {
      state: 'Pausado',
      sub: 'Conexão pronta e pausada por você — nenhum pedido novo é cobrado aqui.',
    },
    pausedChip: 'Pausado',
    readyNotReceiving: {
      state: 'Ainda não está recebendo',
      sub: 'Tudo pronto — ligue a chave para começar a receber.',
    },
  },
  listBadge: {
    active: 'Ativo',
    connected: 'Conectado',
    reconnect: 'Reconectar',
    notConnected: 'Não conectado',
  },
  environment: {
    production: 'Produção',
    sandbox: 'Sandbox',
    groupLabel: 'Ambiente desta conexão',
    productionMeaning: 'Produção — dinheiro real.',
    sandboxMeaning: 'Sandbox — ambiente de teste.',
    productionConsequence: 'Tudo o que você fizer aqui vale para as vendas da loja.',
    sandboxConsequence: 'Nenhum valor sai ou entra de verdade.',
    storeIsUsing: (environmentName) => ` Hoje a loja está usando ${environmentName}.`,
  },
  oauth: {
    connectAction: (displayName) => `Conectar com ${displayName}`,
    reconnectAction: 'Reconectar',
    removeAction: 'Remover conexão',
    invitation: (displayName) =>
      `Conecte sua conta ${displayName} autorizando o acesso no site do provedor. Nenhuma chave precisa ser copiada.`,
    roundTripNote: 'Você sai para o provedor e volta para cá — leva menos de um minuto.',
    connectedExplainer:
      'Sua conta está conectada. As cobranças são criadas em seu nome — nenhuma chave precisa ser copiada.',
    connectedNote: (displayName) =>
      `Conta ${displayName} conectada. Revogue quando quiser, aqui ou no painel do provedor.`,
    connectedAt: (when) => `Conectada em ${when}`,
    validUntil: (when) => `Autorização válida até ${when}`,
    expiredAt: (when) =>
      `A autorização expirou em ${when}. Reconecte para voltar a receber pagamentos.`,
    expiresAt: (when) =>
      `A autorização expira em ${when}. Se o aviso continuar, reconecte a conta.`,
    revoked: 'A autorização expirou ou foi revogada. Reconecte para voltar a receber pagamentos.',
    notAvailableHere: (displayName) =>
      `A conexão automática com ${displayName} não está disponível nesta instalação — ` +
      'o aplicativo de autorização não foi cadastrado. Para conectar agora, abra ' +
      '“Prefiro informar as credenciais manualmente” abaixo e cole as suas próprias chaves.',
    preferOAuth: 'Prefiro conectar por autorização',
    preferCredentials: 'Prefiro informar as credenciais manualmente',
    scopes: {
      read: 'Consultar pagamentos',
      create: 'Criar cobranças',
      refund: 'Estornar pagamentos',
      account: 'Consultar dados da conta',
    },
  },
  card: {
    accountHeading: (displayName) => `Conta ${displayName}`,
    accountLabel: 'Conta',
    connectionLabel: 'Conexão',
    authorizedAt: (displayName) => `Autorizada no ${displayName}`,
    environmentLabel: 'Ambiente',
    connectedAtLabel: 'Conectada em',
    sandboxWithNote: 'Sandbox (testes)',
    steps: {
      signIn: (displayName) =>
        `Entre na sua conta ${displayName} — dá para criar uma na hora, se ainda não tiver.`,
      authorize: 'Autorize o acesso na tela do provedor.',
      comeBack: 'Você volta para cá com a conta conectada.',
    },
    removeAction: 'Remover conexão',
    removeQuestion: (displayName) => `Remover a conexão com ${displayName}?`,
    removeConsequenceLive:
      'A loja para de receber na hora e fica sem provedor ativo — pedidos novos não conseguem ser pagos até você conectar outro.',
    removeConsequenceIdle: 'Esta conexão sai da loja. Você pode conectar de novo depois.',
    removeRevokes: (displayName) =>
      `A autorização é revogada no ${displayName}. Sua conta e seu histórico continuam lá, intactos.`,
    removeKeepsSettled: (displayName) =>
      `Pagamentos já aprovados e estornos em andamento seguem normalmente pelo ${displayName}.`,
    removeRestartsSetup: 'Para reconectar, os passos recomeçam do zero.',
    pauseInstead: 'Só pausar o recebimento',
  },
  credentials: {
    configuredKeepBlank: 'Configurado — deixe em branco para manter o valor atual.',
    advancedSuffix: ' · só para plataformas Connect',
    probeAction: 'Testar conexão',
    reverifyWarning: (displayName) =>
      `Esta loja já está verificada. Trocar as credenciais **exige uma nova verificação** ` +
      `e a loja **para de receber** pelo ${displayName} até que ela termine.`,
    probeRunning: 'Testando a conexão…',
    probeSaveNote: 'Salvamos e testamos as chaves no provedor antes de seguir.',
    probeIncompleteNote: 'Guardamos o que você já preencheu. Complete os campos para testar.',
    probeFailed: (environmentName) =>
      `Não foi possível conectar em ${environmentName}. Confira as credenciais deste ambiente.`,
    checkPass: 'Verificado',
    checkFail: 'Corrigir',
    uncheckable: 'Não verificável',
    saveAndTest: 'Salvar e testar conexão',
    save: 'Salvar',
    saveOnly: (fieldLabel) => `Salvar ${fieldLabel}`,
    changeAction: 'Alterar',
  },
  priority: {
    moveUp: (label) => `Mover ${label} para cima`,
    moveDown: (label) => `Mover ${label} para baixo`,
    saveFailed: 'Não foi possível salvar a ordem.',
    firstInChain: 'primeiro',
    retryDeclinedLabel: 'Tentar cartão **recusado** no próximo provedor',
    retryDeclinedOn:
      'Uma recusa passa para o próximo da lista. Isso pode aumentar custos de transação e sinais de fraude.',
    retryDeclinedOff:
      'Padrão: uma recusa encerra a cobrança. Só falhas técnicas passam para o próximo.',
  },
  setupGuide: {
    defaultConfirmLabel: 'Já habilitei o Checkout Integrado',
    confirmedByYou: 'Confirmado por você',
    reviewAction: 'Revisar',
  },
};
