// @vitest-environment jsdom
// fireEvent/render from @testing-library/react — no user-event, no jest-dom.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AiHostGuide } from "../guide";
import { AiStatusBoard, type HostStatus } from "./ai-status-board";

/**
 * The status board is the only surface that names which assistants hold access
 * to a store, so it is where both missing controls belong: revoking one (before
 * `onDisconnect`, a connection could be created from the wizard but never ended
 * from anywhere in the UI) and re-reading a host's setup steps (reachable only
 * from a RED card, so a fully connected board hid them).
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

const statuses = (overrides: Partial<HostStatus>[] = []): HostStatus[] =>
  [
    { host: CLAUDE, connected: true, detail: "ativo há 1 min" },
    { host: CHATGPT, connected: false },
  ].map((status, index) => ({ ...status, ...overrides[index] }));

/** Open the confirmation popup guarding a host's "Desconectar" button. */
const clickDisconnect = (hostId: string): void => {
  fireEvent.click(screen.getByTestId(`ai-status-disconnect-${hostId}`));
};

describe("AiStatusBoard — disconnecting an assistant", () => {
  it("offers Desconectar only on the connected boxes", () => {
    render(<AiStatusBoard statuses={statuses()} onConnect={vi.fn()} onDisconnect={vi.fn()} />);

    expect(screen.getByTestId("ai-status-disconnect-claude")).toBeTruthy();
    // The disconnected host keeps its Conectar call to action instead.
    expect(screen.queryAllByTestId("ai-status-disconnect-chatgpt")).toHaveLength(0);
    expect(screen.getByTestId("ai-status-connect-chatgpt")).toBeTruthy();
  });

  it("keeps the board read-only when the app passes no onDisconnect", () => {
    render(<AiStatusBoard statuses={statuses()} onConnect={vi.fn()} />);

    expect(screen.getByTestId("ai-status-claude")).toBeTruthy();
    expect(screen.queryAllByTestId("ai-status-disconnect-claude")).toHaveLength(0);
  });

  it("reaches a connected host's instructions, which only a red card used to offer", () => {
    const onConnect = vi.fn();
    // Every host connected — the state that left the setup steps unreachable.
    render(
      <AiStatusBoard
        statuses={statuses([{}, { connected: true, detail: "ativo agora" }])}
        onConnect={onConnect}
        onDisconnect={vi.fn()}
      />,
    );

    expect(screen.queryAllByTestId("ai-status-connect-chatgpt")).toHaveLength(0);
    fireEvent.click(screen.getByTestId("ai-status-instructions-chatgpt"));

    // Same navigation the red card's "Conectar" performs.
    expect(onConnect).toHaveBeenCalledWith("chatgpt");
  });

  it("confirms before revoking, and reports the host that was revoked", async () => {
    const onDisconnect = vi.fn();
    render(
      <AiStatusBoard statuses={statuses()} onConnect={vi.fn()} onDisconnect={onDisconnect} />,
    );

    clickDisconnect("claude");

    // The click opens the popup; nothing is revoked until it is confirmed.
    const dialog = await screen.findByTestId("ai-status-disconnect-confirm-claude");
    expect(dialog.textContent).toContain("Claude.ai");
    expect(onDisconnect).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("ai-status-disconnect-confirm-claude-confirm-button"));

    await waitFor(() => expect(onDisconnect).toHaveBeenCalledWith("claude"));
  });

  it("revokes nothing when the owner cancels", async () => {
    const onDisconnect = vi.fn();
    render(
      <AiStatusBoard statuses={statuses()} onConnect={vi.fn()} onDisconnect={onDisconnect} />,
    );

    clickDisconnect("claude");
    const cancel = await screen.findByTestId(
      "ai-status-disconnect-confirm-claude-cancel-button",
    );
    fireEvent.click(cancel);

    await waitFor(() =>
      expect(screen.queryByTestId("ai-status-disconnect-confirm-claude")).toBeNull(),
    );
    expect(onDisconnect).not.toHaveBeenCalled();
  });

  it("holds the popup open carrying the reason when the revoke fails", async () => {
    const onDisconnect = vi.fn().mockRejectedValue(new Error("A loja recusou o pedido."));
    render(
      <AiStatusBoard statuses={statuses()} onConnect={vi.fn()} onDisconnect={onDisconnect} />,
    );

    clickDisconnect("claude");
    fireEvent.click(
      await screen.findByTestId("ai-status-disconnect-confirm-claude-confirm-button"),
    );

    const error = await screen.findByTestId("ai-status-disconnect-confirm-claude-error");
    expect(error.textContent).toContain("A loja recusou o pedido.");
    // Still open — a failed revoke must not read as a completed one.
    expect(screen.queryByTestId("ai-status-disconnect-confirm-claude")).not.toBeNull();
  });
});
