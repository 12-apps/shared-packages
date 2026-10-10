import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { EN_US_CHAT_UI_COPY } from "../client/en-US";
import { ChatConfigError } from "../core/errors";
import { createWebChat } from "../react/index";
import type { ChatSurfaceConfig } from "../ui/surface";
import { seat } from "./fixtures";
import { formatTime, routedFetch } from "./surface-harness";

/**
 * The host options both surfaces share, on the web: short chip labels, the
 * hidden heading, folding the chips, the compact notice, an always-enabled
 * send, and the composer's focus.
 */

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

const agent = seat({ role: "agent", authorId: "u-agent", readerId: "u-agent" });
const field = (): HTMLInputElement => screen.getByLabelText(EN_US_CHAT_UI_COPY.placeholder) as HTMLInputElement;

function mount(options: Partial<ChatSurfaceConfig> = {}) {
  const harness = routedFetch(() => agent);
  const { ChatThread } = createWebChat({ fetch: harness.fetch, copy: EN_US_CHAT_UI_COPY, formatTime, ...options });
  return { harness, ChatThread };
}

describe("the web thread's host options", () => {
  it("labels a chip by the host's words and sends its key", async () => {
    const { ChatThread, harness } = mount({ quickReplyLabel: (key, text) => (key === "arrived" ? "Here" : text) });
    render(<ChatThread endpoint="/thread" />);

    fireEvent.click(await screen.findByText("Here"));
    expect(await screen.findByText("I have arrived.")).toBeTruthy();
    expect(harness.bodies).toContainEqual({ key: "POST /messages", body: { quickReply: "arrived" } });
  });

  it("keeps the heading as the row's name only, and folds the row on the host's say", async () => {
    const { ChatThread } = mount({ quickRepliesHeading: "label" });
    const { rerender } = render(<ChatThread endpoint="/thread" />);

    const row = await screen.findByTestId("chat-quick-replies");
    expect(row.getAttribute("aria-label")).toBe(EN_US_CHAT_UI_COPY.quickReplies);
    await waitFor(() => expect(screen.queryByText(EN_US_CHAT_UI_COPY.quickReplies)).toBeNull());

    rerender(<ChatThread endpoint="/thread" foldQuickReplies />);
    await waitFor(() => expect(screen.queryByTestId("chat-quick-replies")).toBeNull());
  });

  it("shows a compact notice that clears once the draft is edited", async () => {
    const { ChatThread } = mount({ sendFailureNotice: "compact", sendFailureMessage: () => "No contacts here." });
    render(<ChatThread endpoint="/thread" />);
    await screen.findByTestId("chat-quick-arrived");

    fireEvent.change(field(), { target: { value: "ana@example.com" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect((await screen.findByTestId("chat-send-failed")).textContent).toBe("No contacts here.");

    fireEvent.change(field(), { target: { value: "ana" } });
    await waitFor(() => expect(screen.queryByTestId("chat-send-failed")).toBeNull());
  });

  it('leaves the send button enabled on a blank field with sendWhenEmpty="inert", sending nothing', async () => {
    const { ChatThread, harness } = mount({ sendWhenEmpty: "inert" });
    render(<ChatThread endpoint="/thread" />);
    await screen.findByTestId("chat-quick-arrived");

    const send = screen.getByTestId("chat-send") as HTMLButtonElement;
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    expect(harness.calls).not.toContain("POST /messages");
  });

  it("reports the composer's focus", async () => {
    const onFocus = vi.fn();
    const { ChatThread } = mount();
    render(<ChatThread endpoint="/thread" onComposerFocusChange={onFocus} />);
    await screen.findByTestId("chat-quick-arrived");

    fireEvent.focusIn(field());
    expect(onFocus).toHaveBeenLastCalledWith(true);
    fireEvent.focusOut(field());
    expect(onFocus).toHaveBeenLastCalledWith(false);
  });

  it('shows the empty description only while chips are drawn below, with emptyDescription="withQuickReplies"', async () => {
    const { ChatThread } = mount({ emptyDescription: "withQuickReplies" });
    const { rerender } = render(<ChatThread endpoint="/thread" />);
    expect(await screen.findByText(EN_US_CHAT_UI_COPY.emptyDescription)).toBeTruthy();

    rerender(<ChatThread endpoint="/thread" foldQuickReplies />);
    await waitFor(() => expect(screen.queryByText(EN_US_CHAT_UI_COPY.emptyDescription)).toBeNull());
  });

  it("shows the host's line for a failed send in the default alert, and the server's when the host returns null", async () => {
    const line = (code: string | null): string | null => (code === "contact_info" ? "No contacts here." : null);
    const { ChatThread } = mount({ sendFailureMessage: (failure) => line(failure.code) });
    render(<ChatThread endpoint="/thread" />);
    await screen.findByTestId("chat-quick-arrived");

    fireEvent.change(field(), { target: { value: "ana@example.com" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect((await screen.findByTestId("chat-send-failed")).textContent).toContain("No contacts here.");
  });

  it("refuses an unknown option value or a non-function hook at build time", () => {
    const base = { fetch: routedFetch(() => agent).fetch, copy: EN_US_CHAT_UI_COPY, formatTime };
    expect(() => createWebChat({ ...base, quickRepliesHeading: "hidden" as never })).toThrow(ChatConfigError);
    expect(() => createWebChat({ ...base, emptyDescription: "never" as never })).toThrow(ChatConfigError);
    expect(() => createWebChat({ ...base, sendFailureNotice: "toast" as never })).toThrow(ChatConfigError);
    expect(() => createWebChat({ ...base, sendWhenEmpty: "hidden" as never })).toThrow(ChatConfigError);
    expect(() => createWebChat({ ...base, sendFailureMessage: "No" as never })).toThrow(ChatConfigError);
    expect(() => createWebChat({ ...base, quickReplyLabel: "Here" as never })).toThrow(ChatConfigError);
  });
});
