/**
 * AI-integration guide content — the reusable copy for a store's "Integração com
 * IA" onboarding. Pure, public, non-sensitive text (no React) so the on-page
 * walkthrough stays a portable, testable content module. Host brand marks/icons
 * and colours live in the components. Apps may pass their own overrides to
 * `<AiIntegrationOnboarding>`; these are the shared defaults.
 *
 * The MCP endpoint URL is NOT hardcoded here — the app derives it per request
 * from the deployment origin and passes it in.
 */

/** Which brand a host belongs to — drives the icon/accent in the UI. */
export type AiHostBrand = "claude" | "openai";

export interface AiHostLink {
  /** Deep-link straight to the host's connector settings, when one exists. */
  url: string;
  label: string;
}

/**
 * One stage of the "configure the connector" part of the flow. A host can split
 * configuration across several stages, each with its OWN deep link, step label
 * and instructions — e.g. ChatGPT needs "enable developer mode" (Security
 * settings) and then "configurar" (create the connector). When a host declares
 * `configureStages`, the wizard renders one wizard step per stage (between
 * "Copiar URL" and "Confirmar") instead of the default Configurar/Conectar
 * split, and the sign-in happens inside a stage — no prompt to paste.
 */
export interface AiHostConfigureStage {
  /** Stable id — also the wizard step id + test id suffix (`ai-stage-${id}`). */
  id: string;
  /** Step label shown in the stepper. */
  label: string;
  /** Optional deep link opened on this stage (unlocks "Próximo" once opened). */
  link?: AiHostLink;
  /** The instructions shown for this stage. */
  steps: readonly string[];
}

/**
 * The AI providers a connection can be attributed to — derived server-side from
 * the OAuth client's redirect URIs (and confirmed by the `announceAiConnection`
 * tool). Drives which host card lights up green on the status board.
 */
export type AiProvider = "claude" | "chatgpt" | "codex";

/** The provider a host id belongs to (claude-desktop shares Claude's provider). */
export function providerForHostId(hostId: string): AiProvider | null {
  if (hostId === "claude" || hostId === "claude-desktop") return "claude";
  if (hostId === "chatgpt") return "chatgpt";
  if (hostId === "codex") return "codex";
  return null;
}

export interface AiHostGuide {
  /** Stable id — also the panel test id suffix (`ai-setup-${id}`). */
  id: string;
  /** Tab label shown to the owner. */
  label: string;
  brand: AiHostBrand;
  /** One-line hint of what this host is (web app, desktop app, CLI…). */
  kind: string;
  /** Optional direct link button (desktop apps have no deep link). */
  link?: AiHostLink;
  /**
   * Optional link to the host's OFFICIAL connector docs — a stable vendor URL
   * shown as a "Para mais informações" reference (never a deep link with a
   * volatile connector id / UI params).
   */
  docs?: AiHostLink;
  steps: readonly string[];
  /**
   * Optional per-stage configuration (each with its own deep link + label). When
   * present, the wizard renders one step per stage in place of the default
   * Configurar → Conectar split, and `steps` mirrors the flattened stage
   * instructions so the MCP guide stays a single source of truth.
   */
  configureStages?: readonly AiHostConfigureStage[];
  /**
   * Optional deep link to a PUBLISHED one-click plugin/connector for this host
   * (set per app via env, e.g. `CHATGPT_PLUGIN_URL` / `CLAUDE_PLUGIN_URL`). When
   * present, the wizard swaps the manual "copy URL + configure connector" path
   * for a simplified "open → Install → authorize" flow: the owner never copies
   * the MCP URL. Absent → the full manual flow.
   */
  pluginUrl?: string;
}

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
const CHATGPT_CONFIGURE_STAGES: readonly AiHostConfigureStage[] = [
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
      'Clique em "Sign in with Future Drink" e entre com a sua conta de lojista para autorizar o acesso. Pronto: a conexão é registrada automaticamente.',
    ],
  },
];

/**
 * The AI hosts a store owner can connect, in recommended order. Same OAuth flow
 * everywhere (the host drives it) — only the menu path differs per app.
 */
export const AI_HOST_GUIDES: readonly AiHostGuide[] = [
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
    link: { url: "https://chatgpt.com/plugins", label: "Abrir os plugins do ChatGPT" },
    docs: {
      url: "https://developers.openai.com/apps-sdk/deploy/connect-chatgpt",
      label: "documentação oficial da OpenAI — conectar um servidor MCP ao ChatGPT",
    },
    configureStages: CHATGPT_CONFIGURE_STAGES,
    // Mirrors the flattened stage instructions so the MCP connect guide
    // (`connectToChatGpt`) can never drift from what owners see in the wizard.
    steps: CHATGPT_CONFIGURE_STAGES.flatMap((stage) => stage.steps),
  },
  {
    id: "codex",
    label: "Codex",
    brand: "openai",
    kind: "App / CLI de desenvolvedor",
    link: { url: "https://developers.openai.com/codex", label: "Documentação do Codex" },
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

export interface AiCapability {
  /** Stable id — maps to an icon in the component. */
  id: string;
  /** Card headline. */
  title: string;
  /** Short supporting line, usually an example prompt in quotes. */
  detail: string;
}

/** What a connected assistant does for the owner — one marketing card each. */
export const AI_CAPABILITIES: readonly AiCapability[] = [
  {
    id: "orders",
    title: "Acompanhe seus pedidos",
    detail: '"Quais pedidos entraram hoje?"',
  },
  {
    id: "inventory",
    title: "Controle o estoque",
    detail: '"Quanto ainda tenho do produto X? Registre a entrada de 20 unidades."',
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
export const AI_PERMISSION_MODEL =
  "O assistente age em seu nome, com exatamente as suas permissões: ele pode fazer o que você pode fazer na sua loja — nada além disso. Não é preciso criar nenhuma chave ou credencial extra; a autorização usa o seu próprio login.";

/**
 * The message the owner pastes into the assistant's chat right after connecting.
 * It makes the assistant (1) call `announceAiConnection` reporting which host it
 * is (chatgpt / claude / codex) — the tool that registers the connection on the
 * server side so the store learns which assistant connected — and (2) call a
 * real read tool to confirm access. The owner types nothing.
 */
export const AI_CONNECT_PROMPT =
  "Você agora tem acesso ao conector MCP da minha loja. Faça, nesta ordem:\n" +
  '1) Execute a ferramenta announceAiConnection informando qual assistente você é (host: "chatgpt", "claude" ou "codex") para registrar a conexão com a minha loja.\n' +
  "2) Execute a ferramenta listInventory para confirmar o acesso ao estoque da minha loja.\n" +
  "Se precisar do identificador da loja, me pergunte o tenantSlug.";
