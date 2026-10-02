import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EN_US_CHAT_UI_COPY } from "../client/en-US";
import { createWebChat } from "../react/index";
import { seat } from "./fixtures";
import { formatTime, routedFetch } from "./surface-harness";

/**
 * The web surface, rendered with the design system's web primitives against
 * the real routes. One thread, the way a host mounts it.
 */

const agent = seat({ role: "agent", authorId: "u-agent", readerId: "u-agent" });

function mount(actor = () => seat() as ReturnType<typeof seat> | null, overrides = {}) {
  const harness = routedFetch(actor, overrides);
  const { ChatThread } = createWebChat({ fetch: harness.fetch, copy: EN_US_CHAT_UI_COPY, formatTime });
  return { harness, ChatThread };
}

describe("the web thread", () => {
  it("starts empty, sends, and shows the message under the sender's role label", async () => {
    const { ChatThread } = mount();
    render(<ChatThread endpoint="/thread" />);
    expect(await screen.findByText(EN_US_CHAT_UI_COPY.emptyTitle)).toBeTruthy();

    fireEvent.change(screen.getByLabelText(EN_US_CHAT_UI_COPY.placeholder), { target: { value: "Gate 12" } });
    fireEvent.click(screen.getByTestId("chat-send"));

    await waitFor(() => expect(screen.getByText("Gate 12")).toBeTruthy());
    expect(screen.getByText("Client")).toBeTruthy();
    expect((screen.getByLabelText(EN_US_CHAT_UI_COPY.placeholder) as HTMLInputElement).value).toBe("");
  });

  it("shows the server's own sentence when a send is refused, and keeps the draft", async () => {
    const { ChatThread } = mount(() => agent);
    render(<ChatThread endpoint="/thread" />);
    await screen.findByText(EN_US_CHAT_UI_COPY.emptyTitle);

    fireEvent.change(screen.getByLabelText(EN_US_CHAT_UI_COPY.placeholder), { target: { value: "11 98765-4321" } });
    fireEvent.click(screen.getByTestId("chat-send"));

    expect(await screen.findByText(/phone numbers, e-mail addresses, links and social profiles/)).toBeTruthy();
    expect((screen.getByLabelText(EN_US_CHAT_UI_COPY.placeholder) as HTMLInputElement).value).toBe("11 98765-4321");
  });

  it("offers the role's quick replies and sends one with a tap", async () => {
    const { ChatThread } = mount(() => agent);
    render(<ChatThread endpoint="/thread" />);
    fireEvent.click(await screen.findByText("On my way."));
    await waitFor(() => expect(screen.getAllByText("On my way.")).toHaveLength(2));
    expect(screen.getByText("Agent")).toBeTruthy();
  });

  it("turns read-only when the caller may no longer write", async () => {
    const { ChatThread } = mount(() => seat({ canWrite: false }));
    render(<ChatThread endpoint="/thread" />);
    expect(await screen.findByText(EN_US_CHAT_UI_COPY.closed)).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId("chat-input")).toBeNull());
  });

  it("shows the load error with a retry when the thread cannot be read", async () => {
    const { ChatThread } = mount(() => null);
    render(<ChatThread endpoint="/thread" />);
    expect(await screen.findByText(EN_US_CHAT_UI_COPY.loadError)).toBeTruthy();
    expect(screen.getByText(EN_US_CHAT_UI_COPY.retry)).toBeTruthy();
  });

  it("reloads when the host's refresh signal moves, and reports then clears the unread count", async () => {
    const onUnread = vi.fn();
    const { ChatThread, harness } = mount();
    const view = render(<ChatThread endpoint="/thread" refreshSignal={0} onUnreadChange={onUnread} />);
    await screen.findByText(EN_US_CHAT_UI_COPY.emptyTitle);

    // The other side writes (the first read opened the thread); the host's
    // live channel then bumps the signal.
    harness.db.messages.push({
      id: "m-agent",
      threadId: harness.db.threads[0]!.id,
      tenantId: "t1",
      authorRole: "agent",
      authorId: "u-agent",
      body: "Downstairs now",
      quickKey: null,
      createdAt: new Date("2026-10-02T12:05:00.000Z"),
    });
    await act(async () => {
      view.rerender(<ChatThread endpoint="/thread" refreshSignal={1} onUnreadChange={onUnread} />);
    });

    expect(await screen.findByText("Downstairs now")).toBeTruthy();
    await waitFor(() => expect(onUnread).toHaveBeenLastCalledWith(0));
    expect(onUnread).toHaveBeenCalledWith(1);
    expect(harness.calls).toContain("POST /read");
  });

  it("refuses to build without the host's fetch, time format or a complete copy", () => {
    expect(() => createWebChat({ fetch: undefined as never, copy: EN_US_CHAT_UI_COPY, formatTime })).toThrow(/fetch is required/);
    expect(() => createWebChat({ fetch: vi.fn(), copy: EN_US_CHAT_UI_COPY, formatTime: undefined as never })).toThrow(/formatTime/);
    expect(() => createWebChat({ fetch: vi.fn(), copy: { ...EN_US_CHAT_UI_COPY, send: "" }, formatTime })).toThrow(/missing: send/);
  });
});
