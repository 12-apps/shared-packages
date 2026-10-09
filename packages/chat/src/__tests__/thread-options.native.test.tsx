import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EN_US_CHAT_UI_COPY } from "../client/en-US";
import { ChatConfigError } from "../core/errors";
import { createNativeChat, NATIVE_CHAT_METRICS, type NativeChatSurfaceConfig } from "../native/index";
import { seat } from "./fixtures";
import { formatTime, routedFetch } from "./surface-harness";

/**
 * The native thread's host options: short chip labels for the server's reply
 * keys, the pill look, a row that scrolls sideways on a narrow phone, folding
 * the chips, the compact notice on the composer, an always-solid send, and
 * the composer's focus — the pieces a host on a small phone sizes its room by.
 */

const agent = seat({ role: "agent", authorId: "u-agent", readerId: "u-agent" });
const field = (): HTMLInputElement => screen.getByPlaceholderText(EN_US_CHAT_UI_COPY.placeholder) as HTMLInputElement;
const SHORT: Record<string, string> = { arrived: "Here" };
const shortLabel = (key: string, text: string): string => SHORT[key] ?? text;

function mount(options: Partial<NativeChatSurfaceConfig> = {}) {
  const harness = routedFetch(() => agent);
  const { ChatThread } = createNativeChat({ fetch: harness.fetch, copy: EN_US_CHAT_UI_COPY, formatTime, ...options });
  return { harness, ChatThread };
}

describe("the native thread's quick replies", () => {
  it("names a chip by the host's label, sends its KEY, and shows the server's sentence for a key the host does not know", async () => {
    const { ChatThread, harness } = mount({ quickReplyLabel: shortLabel });
    render(<ChatThread endpoint="/thread" />);

    expect(await screen.findByText("Here")).toBeTruthy();
    expect(screen.getByText("On my way.")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("I have arrived.")).toBeNull());

    fireEvent.click(screen.getByTestId("chat-quick-arrived"));
    // The full sentence is what the thread stores and shows.
    expect(await screen.findByText("I have arrived.")).toBeTruthy();
    expect(harness.bodies).toContainEqual({ key: "POST /messages", body: { quickReply: "arrived" } });
  });

  it("falls back to the server's sentence when the host's label is blank", async () => {
    const { ChatThread } = mount({ quickReplyLabel: () => "  " });
    render(<ChatThread endpoint="/thread" />);
    expect(await screen.findByText("I have arrived.")).toBeTruthy();
  });

  it("draws pills at least the touch floor tall, with a bold label", async () => {
    const { ChatThread } = mount({ quickReplyLook: "pill", quickReplyLabel: shortLabel });
    render(<ChatThread endpoint="/thread" />);

    const pill = await screen.findByTestId("chat-quick-arrived");
    expect(getComputedStyle(pill).minHeight).toBe(`${NATIVE_CHAT_METRICS.quickReplyMinHeight}px`);
    expect(pill.getAttribute("role")).toBe("button");
    expect(pill.getAttribute("aria-label")).toBe("Here");
    // The inline style, not the computed one: jsdom does not resolve a numeric weight.
    expect(["bold", "700"]).toContain(screen.getByText("Here").style.fontWeight);
  });

  it("keeps the heading only as the row's accessible name when asked", async () => {
    const { ChatThread } = mount({ quickRepliesHeading: "label" });
    render(<ChatThread endpoint="/thread" />);

    const row = await screen.findByTestId("chat-quick-replies");
    expect(row.getAttribute("aria-label")).toBe(EN_US_CHAT_UI_COPY.quickReplies);
    await waitFor(() => expect(screen.queryByText(EN_US_CHAT_UI_COPY.quickReplies)).toBeNull());
  });

  it("wraps the chips by default, and puts them on one sideways-scrolling line below the given width", async () => {
    const wide = mount();
    const { unmount } = render(<wide.ChatThread endpoint="/thread" />);
    expect(getComputedStyle(await screen.findByTestId("chat-quick-row")).flexWrap).toBe("wrap");
    unmount();

    // jsdom's window is 1024 wide: anything wider is a "narrow" phone here.
    const narrow = mount({ quickReplyScrollBelowWidth: 2000 });
    render(<narrow.ChatThread endpoint="/thread" />);
    const line = await screen.findByTestId("chat-quick-row");
    expect(getComputedStyle(line).flexWrap).not.toBe("wrap");
    expect(getComputedStyle(line).overflowX).toMatch(/auto|scroll/);
  });

  it("folds the quick replies on the host's say, keeping the draft, and drops a description that points at them", async () => {
    const { ChatThread } = mount({ emptyDescription: "withQuickReplies" });
    const { rerender } = render(<ChatThread endpoint="/thread" />);
    expect(await screen.findByText(EN_US_CHAT_UI_COPY.emptyDescription)).toBeTruthy();

    fireEvent.change(field(), { target: { value: "Gate 12" } });
    rerender(<ChatThread endpoint="/thread" foldQuickReplies />);

    await waitFor(() => expect(screen.queryByTestId("chat-quick-replies")).toBeNull());
    await waitFor(() => expect(screen.queryByText(EN_US_CHAT_UI_COPY.emptyDescription)).toBeNull());
    expect(field().value).toBe("Gate 12");
  });

  it("keeps the empty description by default, folded or not", async () => {
    const { ChatThread } = mount();
    render(<ChatThread endpoint="/thread" foldQuickReplies />);
    expect(await screen.findByText(EN_US_CHAT_UI_COPY.emptyDescription)).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId("chat-quick-replies")).toBeNull());
  });
});

describe("the native thread's compact notice", () => {
  it("shows the host's line for a refusal on the composer, and clears it once the draft is edited", async () => {
    const onNoticeHeight = vi.fn();
    const { ChatThread } = mount({
      sendFailureNotice: "compact",
      sendFailureMessage: (failure) => (failure.code === "contact_info" ? "No contacts here." : null),
    });
    render(<ChatThread endpoint="/thread" onNoticeHeight={onNoticeHeight} />);
    await screen.findByTestId("chat-quick-arrived");

    fireEvent.change(field(), { target: { value: "ana@example.com" } });
    fireEvent.click(screen.getByTestId("chat-send"));

    const notice = await screen.findByTestId("chat-send-failed");
    expect(notice.textContent).toBe("No contacts here.");
    expect(notice.getAttribute("role")).toBe("alert");
    onNoticeHeight.mockClear();

    fireEvent.change(field(), { target: { value: "ana" } });
    await waitFor(() => expect(screen.queryByTestId("chat-send-failed")).toBeNull());
    expect(onNoticeHeight).toHaveBeenLastCalledWith(0);
  });

  it("falls back to the server's sentence when the host has no line for the failure", async () => {
    const { ChatThread } = mount({ sendFailureNotice: "compact", sendFailureMessage: () => null });
    render(<ChatThread endpoint="/thread" />);
    await screen.findByTestId("chat-quick-arrived");

    fireEvent.change(field(), { target: { value: "ana@example.com" } });
    fireEvent.click(screen.getByTestId("chat-send"));
    expect((await screen.findByTestId("chat-send-failed")).textContent).toMatch(/e-mail addresses/);
  });

  it("keeps the default alert until the next send, even while the draft is edited", async () => {
    const { ChatThread } = mount();
    render(<ChatThread endpoint="/thread" />);
    await screen.findByTestId("chat-quick-arrived");

    fireEvent.change(field(), { target: { value: "ana@example.com" } });
    fireEvent.click(screen.getByTestId("chat-send"));
    await screen.findByTestId("chat-send-failed");

    fireEvent.change(field(), { target: { value: "ana" } });
    expect(screen.getByTestId("chat-send-failed")).toBeTruthy();
  });

  it("reports no notice once the thread goes away", async () => {
    const onNoticeHeight = vi.fn();
    const { ChatThread } = mount({ sendFailureNotice: "compact" });
    const { unmount } = render(<ChatThread endpoint="/thread" onNoticeHeight={onNoticeHeight} />);
    await screen.findByTestId("chat-quick-arrived");
    onNoticeHeight.mockClear();

    unmount();
    expect(onNoticeHeight).toHaveBeenCalledWith(0);
  });
});

describe("the native composer's host options", () => {
  it('keeps the send button enabled on a blank field with sendWhenEmpty="inert", and a blank send does nothing', async () => {
    const { ChatThread, harness } = mount({ sendWhenEmpty: "inert" });
    render(<ChatThread endpoint="/thread" />);
    await screen.findByTestId("chat-quick-arrived");

    const send = screen.getByTestId("chat-send");
    expect(send.getAttribute("aria-disabled")).not.toBe("true");
    fireEvent.click(send);
    expect(harness.calls).not.toContain("POST /messages");
  });

  it("disables the send button on a blank field by default", async () => {
    const { ChatThread } = mount();
    render(<ChatThread endpoint="/thread" />);
    await screen.findByTestId("chat-quick-arrived");
    expect(screen.getByTestId("chat-send").getAttribute("aria-disabled")).toBe("true");
  });

  it("tells the host when the field takes and loses the focus, and when it goes away focused", async () => {
    const onFocus = vi.fn();
    const { ChatThread } = mount();
    const { unmount } = render(<ChatThread endpoint="/thread" onComposerFocusChange={onFocus} />);
    await screen.findByTestId("chat-quick-arrived");

    fireEvent.focusIn(field());
    expect(onFocus).toHaveBeenLastCalledWith(true);
    fireEvent.focusOut(field());
    expect(onFocus).toHaveBeenLastCalledWith(false);

    fireEvent.focusIn(field());
    onFocus.mockClear();
    unmount();
    expect(onFocus).toHaveBeenCalledWith(false);
  });
});

describe("the native surface's config", () => {
  const base = { fetch: routedFetch(() => agent).fetch, copy: EN_US_CHAT_UI_COPY, formatTime };

  it("refuses an unknown look, width or option value at build time", () => {
    expect(() => createNativeChat({ ...base, quickReplyLook: "round" as never })).toThrow(ChatConfigError);
    expect(() => createNativeChat({ ...base, quickReplyScrollBelowWidth: 0 })).toThrow(ChatConfigError);
    expect(() => createNativeChat({ ...base, sendFailureNotice: "toast" as never })).toThrow(ChatConfigError);
    expect(() => createNativeChat({ ...base, quickReplyLabel: "Here" as never })).toThrow(ChatConfigError);
  });
});
