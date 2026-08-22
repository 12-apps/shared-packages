import type {
  AiCapability,
  AiConnectPromptSpec,
  AiHostConfigureStage,
  AiHostGuide,
  AiPermissionModel,
} from "./guide";

/**
 * The pt-BR pack for the AI-integration surface — NAMED constants a host passes
 * by hand, never defaults (FUT-760).
 *
 * The filename is what exempts this file from the copy-portability gate:
 * Portuguese may ship, it may not be silent. Every sentence here is VERBATIM
 * what `guide.ts` used to compile in, so a host adopting it sees no change on
 * screen — what changes is that the walkthrough is chosen in a diff.
 *
 * The guides are DATA as much as copy: which assistants are offered, their
 * stage ids and brands. Both halves travel together because a step label and
 * the stage it labels are useless apart.
 */

const CONNECTOR_TAIL: readonly string[] = [
  "Deixe OAuth Client ID e Client Secret em branco — não é preciso gerar credenciais: a loja registra o conector automaticamente no primeiro acesso.",
  "Confirme e clique em Connect: abre a tela de login da loja — entre com a SUA conta de lojista e autorize o acesso.",
  "Pronto: ative o conector na conversa para o assistente consultar e operar a sua loja.",
];

/**
 * ChatGPT's two-stage configuration (Developer mode is now required before a
 * connector can be created). Stage 1 enables Developer mode in Security & login;
 * stage 2 creates the connector and signs in — which registers the connection on
 * the store side, so no prompt needs to be pasted afterwards.
 */
function chatgptConfigureStages(
  platformName: string,
): readonly AiHostConfigureStage[] {
  return [
    {
      id: "enable-dev-mode",
      label: "enable developer mode",
      link: {
        url: "https://chatgpt.com/plugins#settings/Security",
        label: "Abrir Segurança e login",
      },
      steps: [
        "Ative o Modo desenvolvedor em Settings › Security and login (Segurança e login).",
      ],
    },
    {
      id: "configurar",
      label: "configurar",
      link: {
        url: "https://chatgpt.com/plugins#settings/Connectors?create-connector=true&redirectAfter=%2Fplugins",
        label: "Criar o conector",
      },
      steps: [
        "Isso vai abrir um popup para você criar um plugin novo. Coloque como nome o nome da sua loja e, no campo MCP, o link copiado no passo anterior.",
        'Marque a caixa "I understand and want to continue" — a OpenAI não revisou este servidor MCP; ela avisa que sites podem tentar roubar seus dados ou induzir o modelo a ações indevidas, incluindo destruir dados.',
        `Clique em "Sign in with ${platformName}" e entre com a sua conta de lojista para autorizar o acesso. Pronto: a conexão é registrada automaticamente.`,
      ],
    },
  ];
}

/**
 * The AI hosts a store owner can connect, in recommended order. Same OAuth flow
 * everywhere (the host drives it) — only the menu path differs per app.
 *
 * A FUNCTION of the platform's name, because one step is not generic: the
 * ChatGPT connector's consent screen shows an OAuth button labelled with
 * whoever operates the server, and the owner is told which button to click. It
 * used to name one particular STORE on one particular deployment — not even the
 * product, a tenant of it — so every other adopter instructed its owners to
 * click a button that does not exist.
 */
export function PT_BR_AI_HOST_GUIDES(platformName: string): readonly AiHostGuide[] {
  const chatgptStages = chatgptConfigureStages(platformName);
  return [
    {
      id: "claude",
      label: "Claude.ai",
      brand: "claude",
      kind: "No navegador",
      link: {
        url: "https://claude.ai/new?modal=add-custom-connector#settings/customize-connectors",
        label: "Abrir os conectores do Claude",
      },
      docs: {
        url: "https://support.anthropic.com/en/articles/11175166-how-do-i-connect-mcp-servers-to-claude-ai",
        label: "documentação oficial da Anthropic — conectores personalizados",
      },
      steps: [
        "Clique no botão acima (ou vá em Settings › Customize › Connectors) e escolha Add custom connector.",
        "Dê um nome ao conector (ex.: o nome da sua loja) e cole a URL do servidor MCP da sua loja (copie acima) no campo de URL.",
        ...CONNECTOR_TAIL,
      ],
    },
    {
      id: "claude-desktop",
      label: "Claude Desktop",
      brand: "claude",
      kind: "Aplicativo (Windows/Mac)",
      docs: {
        url: "https://support.anthropic.com/en/articles/11175166-how-do-i-connect-mcp-servers-to-claude-ai",
        label: "documentação oficial da Anthropic — conectores personalizados",
      },
      steps: [
        "Abra o Claude Desktop e vá em Settings (⚙️) › Connectors.",
        "Clique em Add custom connector e cole a URL do servidor MCP da sua loja (copie acima).",
        ...CONNECTOR_TAIL,
      ],
    },
    {
      id: "chatgpt",
      label: "ChatGPT",
      brand: "openai",
      kind: "No navegador",
      link: {
        url: "https://chatgpt.com/plugins",
        label: "Abrir os plugins do ChatGPT",
      },
      docs: {
        url: "https://developers.openai.com/apps-sdk/deploy/connect-chatgpt",
        label:
          "documentação oficial da OpenAI — conectar um servidor MCP ao ChatGPT",
      },
      configureStages: chatgptStages,
      // Mirrors the flattened stage instructions so the MCP connect guide
      // (`connectToChatGpt`) can never drift from what owners see in the wizard.
      steps: chatgptStages.flatMap((stage) => stage.steps),
    },
    {
      id: "codex",
      label: "Codex",
      brand: "openai",
      kind: "App / CLI de desenvolvedor",
      link: {
        url: "https://developers.openai.com/codex",
        label: "Documentação do Codex",
      },
      docs: {
        url: "https://developers.openai.com/apps-sdk/deploy/connect-chatgpt",
        label: "documentação oficial da OpenAI — conectar um servidor MCP",
      },
      steps: [
        "No Codex, abra as configurações de MCP (Settings › MCP no app, ou o arquivo de configuração na CLI).",
        "Adicione um servidor MCP e cole a URL do servidor MCP da sua loja (copie acima) como um conector remoto (HTTP).",
        ...CONNECTOR_TAIL,
      ],
    },
  ];
}

export const PT_BR_AI_CAPABILITIES: readonly AiCapability[] = [
  {
    id: "orders",
    title: "Acompanhe seus pedidos",
    detail: '"Quais pedidos entraram hoje?"',
  },
  {
    id: "inventory",
    title: "Controle o estoque",
    detail:
      '"Quanto ainda tenho do produto X? Registre a entrada de 20 unidades."',
  },
  {
    id: "catalog",
    title: "Gerencie o catálogo",
    detail: "Crie e edite produtos e categorias conversando.",
  },
  {
    id: "sales",
    title: "Entenda suas vendas",
    detail: '"Qual foi o faturamento da semana?"',
  },
];

/**
 * The permission model in one line, shown prominently: the assistant acts AS
 * the signed-in owner (auth-passthrough) — it can do exactly what the owner
 * can, nothing more, and no extra credential/API key is ever created.
 */
export const PT_BR_AI_PERMISSION_MODEL: AiPermissionModel =
  "O assistente age em seu nome, com exatamente as suas permissões: ele pode fazer o que você pode fazer na sua loja — nada além disso. Não é preciso criar nenhuma chave ou credencial extra; a autorização usa o seu próprio login.";

/** The pt-BR paste-in prompt, built from the host's own tool names. */
export function PT_BR_AI_CONNECT_PROMPT(spec: AiConnectPromptSpec): string {
  return (
    "Você agora tem acesso ao conector MCP da minha loja. Faça, nesta ordem:\n" +
    `1) Execute a ferramenta ${spec.announceTool} informando qual assistente você é (host: "chatgpt", "claude" ou "codex") para registrar a conexão com a minha loja.\n` +
    `2) Execute a ferramenta ${spec.probeTool} para confirmar o acesso a ${spec.probeSubject}.\n` +
    `Se precisar do identificador da loja, me pergunte o ${spec.identifierName}.`
  );
}
