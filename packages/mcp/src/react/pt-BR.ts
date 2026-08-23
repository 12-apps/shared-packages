import { PT_BR_CONFIRM_ACTION_COPY } from "@12-apps/ui/pt-BR";

import type { McpAiCopy } from "./copy";

/**
 * The pt-BR pack for the AI-integration screens — a NAMED constant a host
 * passes by hand, never a default.
 *
 * The filename is what exempts this file from the copy-portability gate:
 * Portuguese may ship, it may not be silent. Every sentence is VERBATIM what
 * the components used to render, so a host adopting it sees no change on
 * screen — what changes is that the words are chosen in a diff.
 */
export const PT_BR_MCP_AI_COPY: McpAiCopy = {
  capabilities: {
    heading: "O que o assistente faz por você",
    subheading: "Sem planilhas, sem cliques — é só perguntar na conversa.",
  },
  landing: {
    eyebrow: "Integração com IA",
    titleTail: "à sua loja",
    lede:
      "Deixe o Claude, o ChatGPT e outros assistentes responderem sobre o seu cardápio, estoque e " +
      "pedidos — e executarem ações por você, direto na conversa. Com segurança e sem instalar nada.",
    trust: [
      {
        id: "login",
        label: "Usa o seu próprio login",
        caption: "Sem chaves ou credenciais extras",
      },
      { id: "install", label: "Sem instalar nada", caption: "Conecta em poucos minutos" },
      {
        id: "permissions",
        label: "Só o que você pode",
        caption: "As suas permissões, nada além",
      },
      { id: "surface", label: "Navegador ou app", caption: "Claude, ChatGPT, Codex" },
    ],
    start: "Começar",
  },
  flow: {
    steps: {
      select: "Escolher",
      copyUrl: "Copiar URL",
      configure: "Configurar",
      connect: "Conectar",
      install: "Instalar",
      confirm: "Confirmar",
    },
    back: "Voltar",
    next: "Próximo",
    advance: "Continuar",
    finish: "Concluir",
    copyUrl: "Copiar URL",
    copied: "Copiado",
    copyMessage: "Copiar mensagem",
    copyUrlTitle: "Copie a URL da sua loja",
    urlCaption:
      "É o único dado que você cola no assistente — ao copiar, seguimos para o próximo passo.",
    promptCaption:
      "Assim ele se conecta, se identifica (Claude, ChatGPT…) e registramos a conexão.",
    askTitle: "Peça ao assistente para conectar",
    installBody:
      "Abra o plugin da sua loja, clique em Instalar e autorize o acesso — sem copiar URL nem gerar credenciais.",
    installAction: "Instalar o plugin da loja",
    pasteTitle: "Cole esta mensagem no assistente",
    pasteInstallCaption:
      "Cole no assistente para ele se conectar, se identificar e confirmar o acesso.",
    connectedTo: (hostLabel) => `${hostLabel} está conectado à sua loja.`,
    waitingTitle: "Esperando conexão",
    waitingBody: (hostLabel) =>
      `Assim que você autorizar o acesso no ${hostLabel}, ela aparece aqui automaticamente.`,
    testNow: "Testar agora",
  },
  statusBoard: {
    instructions: "Instruções",
    connected: "Conectado",
    notConnected: "Ainda não conectado",
    connect: "Conectar",
    disconnect: "Desconectar",
    disconnectTitle: "Desconectar o assistente?",
    disconnectBody:
      "Ele perde o acesso à sua loja na hora. Para voltar a usar, será preciso conectar de novo.",
    disconnectConfirm: "Desconectar",
    disconnectError: "Não foi possível desconectar. Tente de novo.",
    boardTitle: "Assistentes conectados",
    boardCaption: "Em verde os que já operam a sua loja; em vermelho os que faltam conectar.",
    confirmAction: PT_BR_CONFIRM_ACTION_COPY,
  },
  summary: {
    activeNow: "ativo agora",
    activeMinutes: (minutes) => `ativo há ${minutes} min`,
    activeHours: (hours) => `ativo há ${hours} h`,
    activeDays: (days) => `ativo há ${days} dias`,
    configured: "Integração configurada",
    connectedSuffix: "Conectado",
    connectedSeveral: (names) => `${names} conectados`,
    connectedGeneric: "IA conectada",
  },
  hostSelect: {
    heading: 'Escolha o seu assistente',
    caption: "Selecione onde você usa a IA — o passo a passo é feito sob medida para ele.",
  },
  connectGuide: {
    urlLabel: "URL do servidor da sua loja",
    urlHint: "Copie esta URL e cole no seu assistente para conectá-lo à loja.",
    moreInfo: "Para mais informações, consulte a",
    connectOn: (hostLabel) => `Conectar no ${hostLabel}`,
  },
  onboarding: {
    title: "Conecte assistentes de IA à sua loja",
    editLabel: "Conectar IA",
    collapseLabel: "Ocultar",
  },
};
