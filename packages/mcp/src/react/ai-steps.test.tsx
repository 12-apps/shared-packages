// @vitest-environment jsdom
// fireEvent/render from @testing-library/react — no user-event, no jest-dom.
import { PT_BR_MCP_AI_COPY } from "./pt-BR";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { GuidedNav } from "@12-apps/onboarding";

import type { AiHostGuide } from "../guide";
import type { AiConnection } from "./ai-connection-utils";
import { StatusBoard } from "./ai-steps";

/**
 * `StatusBoard` binds the board to the guided flow. What it has to get right is
 * where the owner LANDS after a revoke: cutting the last assistant off leaves
 * the section "configured" with nothing configured — a collapsed summary hiding
 * an all-red board — so it walks back into the setup steps instead.
 */

const CLAUDE: AiHostGuide = {
  id: "claude",
  label: "Claude.ai",
  brand: "claude",
  kind: "app web",
  steps: ["passo"],
};

const CHATGPT: AiHostGuide = {
  id: "chatgpt",
  label: "ChatGPT",
  brand: "openai",
  kind: "app web",
  steps: ["passo"],
};

/** Claude with a published one-click plugin — the `install` path, not `copy`. */
const CLAUDE_WITH_PLUGIN: AiHostGuide = {
  ...CLAUDE,
  pluginUrl: "https://plugins.example.com/claude",
};

const HOSTS = [CLAUDE, CHATGPT];

const connection = (host: AiConnection["host"]): AiConnection => ({
  clientName: "Claude",
  host,
  lastActiveAt: new Date("2026-07-18T08:30:00.000Z"),
});

function makeNav(): GuidedNav & { goTo: ReturnType<typeof vi.fn> } {
  return {
    activeStepId: "confirm",
    data: { selectedHost: "claude", connectedHost: "claude" },
    pending: false,
    goTo: vi.fn(),
    next: vi.fn(),
    back: vi.fn(),
    complete: vi.fn(),
    restart: vi.fn(),
  };
}

/** Confirm the popup guarding a host's "Desconectar". */
async function confirmDisconnect(hostId: string): Promise<void> {
  fireEvent.click(screen.getByTestId(`ai-status-disconnect-${hostId}`));
  fireEvent.click(
    await screen.findByTestId(`ai-status-disconnect-confirm-${hostId}-confirm-button`),
  );
}

describe("StatusBoard — where a revoke leaves the owner", () => {
  it("returns to the host's setup steps when the last assistant is revoked", async () => {
    const nav = makeNav();
    render(
      <StatusBoard copy={PT_BR_MCP_AI_COPY}
        nav={nav}
        connections={[connection("claude")]}
        hosts={HOSTS}
        onDisconnect={vi.fn()}
      />,
    );

    await confirmDisconnect("claude");

    await waitFor(() =>
      expect(nav.goTo).toHaveBeenCalledWith("copy", { selectedHost: "claude" }),
    );
  });

  it("sends a plugin host back to its install step instead of the copy step", async () => {
    const nav = makeNav();
    render(
      <StatusBoard copy={PT_BR_MCP_AI_COPY}
        nav={nav}
        connections={[connection("claude")]}
        hosts={[CLAUDE_WITH_PLUGIN, CHATGPT]}
        onDisconnect={vi.fn()}
      />,
    );

    await confirmDisconnect("claude");

    await waitFor(() =>
      expect(nav.goTo).toHaveBeenCalledWith("install", { selectedHost: "claude" }),
    );
  });

  it("stays on the board when another assistant is still connected", async () => {
    const nav = makeNav();
    const onDisconnect = vi.fn();
    render(
      <StatusBoard copy={PT_BR_MCP_AI_COPY}
        nav={nav}
        connections={[connection("claude"), connection("chatgpt")]}
        hosts={HOSTS}
        onDisconnect={onDisconnect}
      />,
    );

    await confirmDisconnect("claude");

    // The revoke still happens; only the navigation is withheld, because a
    // board with ChatGPT still live is worth staying on.
    await waitFor(() => expect(onDisconnect).toHaveBeenCalledWith("claude"));
    expect(nav.goTo).not.toHaveBeenCalled();
  });

  it("does not navigate when the revoke itself failed", async () => {
    const nav = makeNav();
    render(
      <StatusBoard copy={PT_BR_MCP_AI_COPY}
        nav={nav}
        connections={[connection("claude")]}
        hosts={HOSTS}
        onDisconnect={vi.fn().mockRejectedValue(new Error("A loja recusou o pedido."))}
      />,
    );

    await confirmDisconnect("claude");

    // The popup holds the reason; walking to the setup steps would claim a
    // disconnect that never landed.
    await screen.findByTestId("ai-status-disconnect-confirm-claude-error");
    expect(nav.goTo).not.toHaveBeenCalled();
  });
});
