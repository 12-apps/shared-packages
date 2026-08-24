import type {
  AiCapability,
  AiConnectPromptSpec,
  AiHostConfigureStage,
  AiHostGuide,
  AiPermissionModel,
} from "./guide";

/**
 * The en-US pack for the AI-integration surface — NAMED constants a host passes
 * by hand, never defaults.
 *
 * The guides are DATA as much as copy: which assistants are offered, their
 * stage ids, their brands and their LINKS. Both halves travel together because
 * a step label and the stage it labels are useless apart — and the parts that
 * are not words do not change between languages:
 *
 *  - `id` and `brand` are the package's own keys, matched on by the component;
 *  - the URLs point at Anthropic's and OpenAI's own pages;
 *  - the UI labels a reader must FIND in those products stay in the product's
 *    own English (`Add custom connector`, `Settings › Security and login`,
 *    `Sign in with …`), which is the same rule that keeps a vendor's field name
 *    untranslated everywhere else here.
 *
 * The pt-BR pack quotes those same labels in English for exactly this reason;
 * what differs between the two packs is the instruction around them.
 */

const CONNECTOR_TAIL: readonly string[] = [
  "Leave OAuth Client ID and Client Secret blank — there are no credentials to generate: the store registers the connector automatically on first access.",
  "Confirm and click Connect: the store's sign-in screen opens — sign in with YOUR own owner account and authorise the access.",
  "Done: enable the connector in the chat so the assistant can query and operate your store.",
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
        label: "Open Security and login",
      },
      steps: [
        "Turn on Developer mode under Settings › Security and login.",
      ],
    },
    {
      id: "configurar",
      label: "configure",
      link: {
        url: "https://chatgpt.com/plugins#settings/Connectors?create-connector=true&redirectAfter=%2Fplugins",
        label: "Create the connector",
      },
      steps: [
        "That opens a popup to create a new plugin. Give it your store's name, and put the link you copied in the previous step in the MCP field.",
        'Tick "I understand and want to continue" — OpenAI has not reviewed this MCP server; they warn that sites may try to steal your data or push the model into harmful actions, including destroying data.',
        `Click "Sign in with ${platformName}" and sign in with your owner account to authorise access. That is it: the connection is registered automatically.`,
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
export function EN_US_AI_HOST_GUIDES(platformName: string): readonly AiHostGuide[] {
  const chatgptStages = chatgptConfigureStages(platformName);
  return [
    {
      id: "claude",
      label: "Claude.ai",
      brand: "claude",
      kind: "In the browser",
      link: {
        url: "https://claude.ai/new?modal=add-custom-connector#settings/customize-connectors",
        label: "Open Claude's connectors",
      },
      docs: {
        url: "https://support.anthropic.com/en/articles/11175166-how-do-i-connect-mcp-servers-to-claude-ai",
        label: "Anthropic's own documentation — custom connectors",
      },
      steps: [
        "Click the button above (or go to Settings › Customize › Connectors) and choose Add custom connector.",
        "Name the connector (your store's name works) and paste your store's MCP server URL (copy it above) into the URL field.",
        ...CONNECTOR_TAIL,
      ],
    },
    {
      id: "claude-desktop",
      label: "Claude Desktop",
      brand: "claude",
      kind: "App (Windows/Mac)",
      docs: {
        url: "https://support.anthropic.com/en/articles/11175166-how-do-i-connect-mcp-servers-to-claude-ai",
        label: "Anthropic's own documentation — custom connectors",
      },
      steps: [
        "Open Claude Desktop and go to Settings (⚙️) › Connectors.",
        "Click Add custom connector and paste your store's MCP server URL (copy it above).",
        ...CONNECTOR_TAIL,
      ],
    },
    {
      id: "chatgpt",
      label: "ChatGPT",
      brand: "openai",
      kind: "In the browser",
      link: {
        url: "https://chatgpt.com/plugins",
        label: "Open ChatGPT's plugins",
      },
      docs: {
        url: "https://developers.openai.com/apps-sdk/deploy/connect-chatgpt",
        label: "OpenAI's own documentation — connecting an MCP server to ChatGPT",
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
      kind: "Developer app / CLI",
      link: {
        url: "https://developers.openai.com/codex",
        label: "Codex documentation",
      },
      docs: {
        url: "https://developers.openai.com/apps-sdk/deploy/connect-chatgpt",
        label: "OpenAI's own documentation — connecting an MCP server",
      },
      steps: [
        "In Codex, open the MCP settings (Settings › MCP in the app, or the config file on the CLI).",
        "Add an MCP server and paste your store's MCP server URL (copy it above) as a remote (HTTP) connector.",
        ...CONNECTOR_TAIL,
      ],
    },
  ];
}

export const EN_US_AI_CAPABILITIES: readonly AiCapability[] = [
  // The `detail` of each is a QUESTION a reader could paste verbatim, so it is
  // written as one rather than described.
  {
    id: "orders",
    title: "Follow your orders",
    detail: '"Which orders came in today?"',
  },
  {
    id: "inventory",
    title: "Keep on top of stock",
    detail: '"How much of product X is left? Record 20 units received."',
  },
  {
    id: "catalog",
    title: "Manage the catalog",
    detail: "Create and edit products and categories by chatting.",
  },
  {
    id: "sales",
    title: "Understand your sales",
    detail: '"What was this week\'s revenue?"',
  },
];

/**
 * The permission model in one line, shown prominently: the assistant acts AS
 * the signed-in owner (auth-passthrough) — it can do exactly what the owner
 * can, nothing more, and no extra credential/API key is ever created.
 */
export const EN_US_AI_PERMISSION_MODEL: AiPermissionModel =
  "The assistant acts on your behalf with exactly your permissions: it can do what you can do in your store — and nothing beyond that. There is no key or extra credential to create; the authorisation uses your own login.";

/** The en-US paste-in prompt, built from the host's own tool names. */
export function EN_US_AI_CONNECT_PROMPT(spec: AiConnectPromptSpec): string {
  // The TOOL NAMES are the host's own identifiers and are interpolated, never
  // translated: the assistant has to call them by the name they are registered
  // under, so a translated verb here is a prompt that does nothing.
  return (
    "You now have access to my store's MCP connector. Do the following, in order:\n" +
    `1) Run the ${spec.announceTool} tool, saying which assistant you are (host: "chatgpt", "claude" or "codex"), to register the connection with my store.\n` +
    `2) Run the ${spec.probeTool} tool to confirm access to ${spec.probeSubject}.\n` +
    `If you need the store identifier, ask me for the ${spec.identifierName}.`
  );
}
