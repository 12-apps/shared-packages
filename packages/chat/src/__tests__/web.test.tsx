import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { ChatFetch } from "../client/api";
import { EN_US_CHAT_UI_COPY } from "../client/en-US";
import { createWebChat } from "../react/index";
import { seat } from "./fixtures";
import { formatTime, replyWith, routedFetch, seedMessage } from "./surface-harness";

/**
 * The web surface, rendered with the design system's web primitives against
 * the real routes. One thread, the way a host mounts it.
 */

const agent = seat({ role: "agent", authorId: "u-agent", readerId: "u-agent" });
const field = (): HTMLInputElement => screen.getByLabelText(EN_US_CHAT_UI_COPY.placeholder) as HTMLInputElement;

// The message list is the design system's ScrollArea, which observes its size; jsdom has no ResizeObserver.
class NoResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
beforeAll(() => {
  vi.stubGlobal("ResizeObserver", NoResizeObserver);
});
afterAll(() => {
  vi.unstubAllGlobals();
});

function mount(actor = () => seat() as ReturnType<typeof seat> | null, overrides = {}) {
  const harness = routedFetch(actor, overrides);
  const { ChatThread } = createWebChat({ fetch: harness.fetch, copy: EN_US_CHAT_UI_COPY, formatTime });
  return { harness, ChatThread, hold: harness.hold, answer: harness.answer };
}

function type(text: string): void {
  fireEvent.change(field(), { target: { value: text } });
}

describe("the web thread", () => {
  it("starts empty, sends, and shows the message under the sender's role label", async () => {
    const { ChatThread } = mount();
    render(<ChatThread endpoint="/thread" />);
    expect(await screen.findByText(EN_US_CHAT_UI_COPY.emptyTitle)).toBeTruthy();

    type("Gate 12");
    fireEvent.click(screen.getByTestId("chat-send"));

    await waitFor(() => expect(screen.getByText("Gate 12")).toBeTruthy());
    expect(screen.getByText("Client")).toBeTruthy();
    expect(field().value).toBe("");
  });

  it("sends on Enter but not on the Enter that confirms an IME composition", async () => {
    const { ChatThread, harness } = mount();
    render(<ChatThread endpoint="/thread" />);
    await screen.findByText(EN_US_CHAT_UI_COPY.emptyTitle);

    type("こんにちは");
    fireEvent.keyDown(field(), { key: "Enter", isComposing: true });
    expect(harness.calls).not.toContain("POST /messages");

    fireEvent.keyDown(field(), { key: "Enter" });
    expect(await screen.findByText("こんにちは")).toBeTruthy();
  });

  it("keeps the field enabled while a message is in flight, and gates only the send button", async () => {
    const { ChatThread, hold } = mount();
    render(<ChatThread endpoint="/thread" />);
    await screen.findByText(EN_US_CHAT_UI_COPY.emptyTitle);

    const release = hold("POST /messages");
    type("Gate 12");
    fireEvent.click(screen.getByTestId("chat-send"));

    expect(await screen.findByText(EN_US_CHAT_UI_COPY.sending)).toBeTruthy();
    expect(field().disabled).toBe(false);
    expect((screen.getByTestId("chat-send") as HTMLButtonElement).disabled).toBe(true);

    await act(async () => release());
    expect(await screen.findByText("Gate 12")).toBeTruthy();
  });

  it("keeps what is typed while a message is in flight", async () => {
    const { ChatThread, hold } = mount();
    render(<ChatThread endpoint="/thread" />);
    await screen.findByText(EN_US_CHAT_UI_COPY.emptyTitle);

    const release = hold("POST /messages");
    type("Gate 12");
    fireEvent.click(screen.getByTestId("chat-send"));
    await screen.findByText(EN_US_CHAT_UI_COPY.sending);
    type("Block B");

    await act(async () => release());
    expect(await screen.findByText("Gate 12")).toBeTruthy();
    expect(field().value).toBe("Block B");
  });

  it("never shows a sentence from a failure that is not the package's own refusal", async () => {
    const { ChatThread, answer } = mount();
    render(<ChatThread endpoint="/thread" />);
    await screen.findByText(EN_US_CHAT_UI_COPY.emptyTitle);

    answer("POST /messages", replyWith(500, { message: "relation chat_messages does not exist" }));
    type("Gate 12");
    fireEvent.click(screen.getByTestId("chat-send"));

    expect(await screen.findByText(EN_US_CHAT_UI_COPY.sendFailed)).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(/chat_messages/)).toBeNull());
  });

  it("survives a host badge callback that throws", async () => {
    const { ChatThread } = mount();
    const onUnread = vi.fn(() => {
      throw new Error("badge store down");
    });
    render(<ChatThread endpoint="/thread" onUnreadChange={onUnread} />);
    expect(await screen.findByText(EN_US_CHAT_UI_COPY.emptyTitle)).toBeTruthy();
    expect(onUnread).toHaveBeenCalled();
  });

  it("drops a load that answers after the thread was unmounted", async () => {
    const { ChatThread, hold, harness } = mount();
    const release = hold("GET /");
    const view = render(<ChatThread endpoint="/thread" />);
    await waitFor(() => expect(harness.calls).toContain("GET /"));
    view.unmount();
    await act(async () => release());
    expect(harness.calls).not.toContain("POST /read");
  });

  it("follows the newest message: the list scrolls to its end when one is added", async () => {
    const { ChatThread } = mount();
    render(<ChatThread endpoint="/thread" />);
    await screen.findByText(EN_US_CHAT_UI_COPY.emptyTitle);

    const region = screen.getByRole("region", { name: EN_US_CHAT_UI_COPY.messagesLabel });
    const scrolled = vi.fn();
    Object.defineProperty(region, "scrollHeight", { configurable: true, value: 960 });
    Object.defineProperty(region, "scrollTop", { configurable: true, get: () => 0, set: scrolled });

    type("Gate 12");
    fireEvent.click(screen.getByTestId("chat-send"));

    await waitFor(() => expect(scrolled).toHaveBeenLastCalledWith(960));
  });

  it("shows the server's own sentence when a send is refused, and keeps the draft", async () => {
    const { ChatThread } = mount(() => agent);
    render(<ChatThread endpoint="/thread" />);
    await screen.findByText(EN_US_CHAT_UI_COPY.emptyTitle);

    type("11 98765-4321");
    fireEvent.click(screen.getByTestId("chat-send"));

    expect(await screen.findByText(/phone numbers, e-mail addresses, links and social profiles/)).toBeTruthy();
    expect(field().value).toBe("11 98765-4321");
  });

  it("turns read-only when a send finds the thread closed mid-session", async () => {
    const writable = vi.fn().mockReturnValueOnce(seat()).mockReturnValue(seat({ canWrite: false }));
    const { ChatThread } = mount(writable);
    render(<ChatThread endpoint="/thread" />);
    await screen.findByText(EN_US_CHAT_UI_COPY.emptyTitle);

    type("Gate 12");
    fireEvent.click(screen.getByTestId("chat-send"));

    expect(await screen.findByText(EN_US_CHAT_UI_COPY.closed)).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId("chat-input")).toBeNull());
  });

  it("reloads when a send finds the thread gone, and shows the server's sentence", async () => {
    const present = vi.fn().mockReturnValueOnce(seat()).mockReturnValue(null);
    const { ChatThread, harness } = mount(present);
    render(<ChatThread endpoint="/thread" />);
    await screen.findByText(EN_US_CHAT_UI_COPY.emptyTitle);

    type("Gate 12");
    fireEvent.click(screen.getByTestId("chat-send"));

    expect(await screen.findByTestId("chat-error")).toBeTruthy();
    expect(screen.getByText("Conversation not found.")).toBeTruthy();
    expect(harness.calls).toEqual(["GET /", "POST /messages", "GET /"]);
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

  it("shows the server's own sentence, with a retry, when the thread cannot be read", async () => {
    const { ChatThread } = mount(() => null);
    render(<ChatThread endpoint="/thread" />);
    expect(await screen.findByText("Conversation not found.")).toBeTruthy();
    expect(screen.getByText(EN_US_CHAT_UI_COPY.retry)).toBeTruthy();
  });

  it.each([
    ["a body outside the envelope", { thread: {}, messages: [], unread: 0 }],
    ["an empty envelope", { data: null }],
    ["a payload missing its messages", { data: { thread: { me: {}, canWrite: true }, unread: 0 } }],
  ])("shows the load error, not a crash, for %s", async (_name, body) => {
    const { ChatThread, answer } = mount();
    answer("GET /", replyWith(200, body));
    render(<ChatThread endpoint="/thread" />);
    expect(await screen.findByText(EN_US_CHAT_UI_COPY.loadError)).toBeTruthy();
  });

  it("reloads when the host's refresh signal moves, and reports then clears the unread count", async () => {
    const onUnread = vi.fn();
    const { ChatThread, harness } = mount();
    const view = render(<ChatThread endpoint="/thread" refreshSignal={0} onUnreadChange={onUnread} />);
    await screen.findByText(EN_US_CHAT_UI_COPY.emptyTitle);

    // The other side writes; the host's live channel then bumps the signal.
    seedMessage(harness.db, { id: "m-agent", body: "Downstairs now", createdAt: "2026-10-02T11:55:00.000Z" });
    await act(async () => {
      view.rerender(<ChatThread endpoint="/thread" refreshSignal={1} onUnreadChange={onUnread} />);
    });

    expect(await screen.findByText("Downstairs now")).toBeTruthy();
    await waitFor(() => expect(onUnread).toHaveBeenLastCalledWith(0));
    expect(onUnread).toHaveBeenCalledWith(1);
    // Read up to the newest message the screen showed — not "now".
    expect(harness.bodies).toContainEqual({ key: "POST /read", body: { upTo: "2026-10-02T11:55:00.000Z" } });
  });

  it("does not report the thread read when marking it read fails", async () => {
    const onUnread = vi.fn();
    const { ChatThread, harness, hold, answer } = mount();
    seedMessage(harness.db, { id: "m-agent", body: "Downstairs now", createdAt: "2026-10-02T11:55:00.000Z" });
    answer("POST /read", replyWith(500, {}));
    const release = hold("POST /read");
    render(<ChatThread endpoint="/thread" onUnreadChange={onUnread} />);

    expect(await screen.findByText("Downstairs now")).toBeTruthy();
    await waitFor(() => expect(harness.calls).toContain("POST /read"));
    await act(async () => release());

    expect(onUnread.mock.calls).toEqual([[1]]);
  });

  it("never marks read with autoMarkRead off, and still reports the unread count", async () => {
    const onUnread = vi.fn();
    const { ChatThread, harness } = mount();
    seedMessage(harness.db, { id: "m-agent", body: "Downstairs now", createdAt: "2026-10-02T11:55:00.000Z" });
    render(<ChatThread endpoint="/thread" autoMarkRead={false} onUnreadChange={onUnread} />);

    expect(await screen.findByText("Downstairs now")).toBeTruthy();
    await waitFor(() => expect(onUnread).toHaveBeenCalledWith(1));
    expect(harness.calls).toEqual(["GET /"]);
  });

  it("keeps a sent message when a load that started before the send answers after it", async () => {
    const onUnread = vi.fn();
    const { ChatThread, hold } = mount();
    const view = render(<ChatThread endpoint="/thread" refreshSignal={0} onUnreadChange={onUnread} />);
    await screen.findByText(EN_US_CHAT_UI_COPY.emptyTitle);

    // A refresh reads the (still empty) thread, but its answer is slow.
    const release = hold("GET /");
    await act(async () => {
      view.rerender(<ChatThread endpoint="/thread" refreshSignal={1} onUnreadChange={onUnread} />);
    });
    type("Gate 12");
    fireEvent.click(screen.getByTestId("chat-send"));
    expect(await screen.findByText("Gate 12")).toBeTruthy();

    await act(async () => release());
    await waitFor(() => expect(onUnread).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Gate 12")).toBeTruthy();
  });

  it("shows nothing of the previous thread once the endpoint changes", async () => {
    const first = routedFetch(() => seat());
    const second = routedFetch(() => seat({ threadKey: "job:2" }));
    const { hold: holdSecond } = second;
    const fetch: ChatFetch = (url, init) => (url.startsWith("/b") ? second.fetch : first.fetch)(url, init);
    const { ChatThread } = createWebChat({ fetch, copy: EN_US_CHAT_UI_COPY, formatTime });
    const view = render(<ChatThread endpoint="/a" />);
    await screen.findByText(EN_US_CHAT_UI_COPY.emptyTitle);
    type("Gate 12");
    fireEvent.click(screen.getByTestId("chat-send"));
    expect(await screen.findByText("Gate 12")).toBeTruthy();

    const release = holdSecond("GET /");
    view.rerender(<ChatThread endpoint="/b" />);
    expect(screen.getByTestId("chat-loading")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("Gate 12")).toBeNull());

    await act(async () => release());
    expect(await screen.findByText(EN_US_CHAT_UI_COPY.emptyTitle)).toBeTruthy();
    expect(field().value).toBe("");
  });

  it("does not leave the previous thread's messages behind when the new one cannot be read", async () => {
    const first = routedFetch(() => seat());
    const second = routedFetch(() => null);
    const fetch: ChatFetch = (url, init) => (url.startsWith("/b") ? second.fetch : first.fetch)(url, init);
    const { ChatThread } = createWebChat({ fetch, copy: EN_US_CHAT_UI_COPY, formatTime });
    const view = render(<ChatThread endpoint="/a" />);
    await screen.findByText(EN_US_CHAT_UI_COPY.emptyTitle);
    type("Gate 12");
    fireEvent.click(screen.getByTestId("chat-send"));
    expect(await screen.findByText("Gate 12")).toBeTruthy();

    view.rerender(<ChatThread endpoint="/b" />);

    expect(await screen.findByText("Conversation not found.")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("Gate 12")).toBeNull());
  });

  it("tolerates trailing slashes on the endpoint", async () => {
    const { harness, ChatThread } = mount();
    render(<ChatThread endpoint="/thread///" />);

    expect(await screen.findByText(EN_US_CHAT_UI_COPY.emptyTitle)).toBeTruthy();
    type("On my way");
    fireEvent.click(screen.getByTestId("chat-send"));

    expect(await screen.findByText("On my way")).toBeTruthy();
    expect(harness.calls).toEqual(expect.arrayContaining(["GET /", "POST /messages"]));
  });

  it("refuses to build without the host's fetch, time format or a complete copy", () => {
    expect(() => createWebChat({ fetch: undefined as never, copy: EN_US_CHAT_UI_COPY, formatTime })).toThrow(/fetch is required/);
    expect(() => createWebChat({ fetch: vi.fn(), copy: EN_US_CHAT_UI_COPY, formatTime: undefined as never })).toThrow(/formatTime/);
    expect(() => createWebChat({ fetch: vi.fn(), copy: { ...EN_US_CHAT_UI_COPY, send: "" }, formatTime })).toThrow(/missing: send/);
  });
});
