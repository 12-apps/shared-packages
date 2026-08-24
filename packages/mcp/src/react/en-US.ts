import { EN_US_CONFIRM_ACTION_COPY } from "@12-apps/ui/en-US";

import type { McpAiCopy } from "./copy";

/**
 * The en-US pack for the AI-integration screens — a NAMED constant a host
 * passes by hand, never a default.
 *
 * `statusBoard.confirmAction` composes `@12-apps/ui`'s own English pack rather
 * than restating it, exactly as the pt-BR side composes the Portuguese one.
 *
 * The assistant NAMES (Claude, ChatGPT, Codex) are products, not words: they
 * are spelled the same in every language, and `hostLabel` arrives as an
 * argument so a sentence can place it where its own grammar wants.
 */
export const EN_US_MCP_AI_COPY: McpAiCopy = {
  capabilities: {
    heading: "What the assistant does for you",
    subheading: "No spreadsheets, no clicking — just ask it in the chat.",
  },
  landing: {
    eyebrow: "AI integration",
    // Three fragments the heading renders around an emphasised middle, so the
    // seam has to survive: "Connect / AI assistants / to your store".
    titleLead: "Connect",
    titleEmphasis: "AI assistants",
    titleTail: "to your store",
    lede:
      "Let Claude, ChatGPT and other assistants answer questions about your menu, stock and " +
      "orders — and take actions for you, right in the chat. Securely, with nothing to install.",
    trust: [
      // The `id`s are the package's own and are NOT words: the component keys
      // its icons off them.
      {
        id: "login",
        label: "Uses your own login",
        caption: "No extra keys or credentials",
      },
      { id: "install", label: "Nothing to install", caption: "Connects in minutes" },
      {
        id: "permissions",
        label: "Only what you can do",
        caption: "Your permissions, nothing beyond them",
      },
      { id: "surface", label: "Browser or app", caption: "Claude, ChatGPT, Codex" },
    ],
    start: "Get started",
  },
  flow: {
    steps: {
      select: "Choose",
      copyUrl: "Copy URL",
      configure: "Configure",
      connect: "Connect",
      install: "Install",
      confirm: "Confirm",
    },
    back: "Back",
    next: "Next",
    advance: "Continue",
    finish: "Finish",
    copyUrl: "Copy URL",
    copied: "Copied",
    copyMessage: "Copy message",
    copyUrlTitle: "Copy your store's URL",
    urlCaption:
      "It is the only thing you paste into the assistant — copying it moves you to the next step.",
    promptCaption:
      "That is how it connects, identifies itself (Claude, ChatGPT…) and how we record the connection.",
    askTitle: "Ask the assistant to connect",
    installBody:
      "Open your store's plugin, click Install and authorise access — no URL to copy, no credentials to generate.",
    installAction: "Install the store plugin",
    pasteTitle: "Paste this message into the assistant",
    pasteInstallCaption:
      "Paste it into the assistant so it connects, identifies itself and confirms access.",
    connectedTo: (hostLabel) => `${hostLabel} is connected to your store.`,
    waitingTitle: "Waiting for the connection",
    waitingBody: (hostLabel) =>
      `As soon as you authorise access in ${hostLabel}, it appears here automatically.`,
    testNow: "Test it now",
  },
  statusBoard: {
    instructions: "Instructions",
    connected: "Connected",
    notConnected: "Not connected yet",
    connect: "Connect",
    disconnect: "Disconnect",
    disconnectTitle: "Disconnect this assistant?",
    disconnectBody:
      "It loses access to your store immediately. To use it again you will have to connect it afresh.",
    disconnectConfirm: "Disconnect",
    disconnectError: "Could not disconnect. Try again.",
    boardTitle: "Connected assistants",
    boardCaption:
      "Green are the ones already working with your store; red are the ones still to connect.",
    confirmAction: EN_US_CONFIRM_ACTION_COPY,
  },
  summary: {
    activeNow: "active now",
    activeMinutes: (minutes) => `active ${minutes} min ago`,
    activeHours: (hours) => `active ${hours} h ago`,
    activeDays: (days) => `active ${days} days ago`,
    configured: "Integration configured",
    connectedSuffix: "Connected",
    connectedSeveral: (names) => `${names} connected`,
    connectedGeneric: "AI connected",
  },
  hostSelect: {
    heading: "Choose your assistant",
    caption: "Pick where you use AI — the walkthrough is tailored to it.",
  },
  connectGuide: {
    urlLabel: "Your store's server URL",
    urlHint: "Copy this URL and paste it into your assistant to connect it to the store.",
    // Ends mid-sentence: the screen renders a documentation link straight after.
    moreInfo: "For more, see the",
    connectOn: (hostLabel) => `Connect in ${hostLabel}`,
  },
  onboarding: {
    title: "Connect AI assistants to your store",
    editLabel: "Connect AI",
    collapseLabel: "Hide",
  },
};
