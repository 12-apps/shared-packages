import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EN_US_CHAT_UI_COPY } from "../client/en-US";
import { createNativeChat } from "../native/index";
import { seat } from "./fixtures";
import { formatTime, routedFetch } from "./surface-harness";

/**
 * The native surface, rendered through `@12-apps/ui`'s NATIVE primitives
 * (the `react-native` export condition) via react-native-web — the same
 * thread screen a React Native app gets, against the real routes.
 */

const agent = seat({ role: "agent", authorId: "u-agent", readerId: "u-agent" });
const field = (): HTMLInputElement => screen.getByPlaceholderText(EN_US_CHAT_UI_COPY.placeholder) as HTMLInputElement;

function mount(actor: () => ReturnType<typeof seat> | null) {
  const harness = routedFetch(actor);
  const { ChatThread } = createNativeChat({ fetch: harness.fetch, copy: EN_US_CHAT_UI_COPY, formatTime });
  return { harness, ChatThread, hold: harness.hold };
}

describe("the native thread", () => {
  it("renders with the native primitives, sends free text, and shows it under the role label", async () => {
    const { ChatThread } = mount(() => seat());
    render(<ChatThread endpoint="/thread" />);
    expect(await screen.findByText(EN_US_CHAT_UI_COPY.emptyTitle)).toBeTruthy();

    fireEvent.change(field(), { target: { value: "Gate 12" } });
    fireEvent.click(screen.getByTestId("chat-send"));

    await waitFor(() => expect(screen.getByText("Gate 12")).toBeTruthy());
    expect(screen.getByText("Client")).toBeTruthy();
  });

  it("draws the messages in a scrolling list, named by the host's copy", async () => {
    const { ChatThread } = mount(() => seat());
    render(<ChatThread endpoint="/thread" />);
    await screen.findByText(EN_US_CHAT_UI_COPY.emptyTitle);

    expect(screen.getByTestId("chat-messages").getAttribute("aria-label")).toBe(EN_US_CHAT_UI_COPY.messagesLabel);
  });

  it("sends from the keyboard's send key", async () => {
    const { ChatThread } = mount(() => seat());
    render(<ChatThread endpoint="/thread" />);
    await screen.findByText(EN_US_CHAT_UI_COPY.emptyTitle);

    fireEvent.change(field(), { target: { value: "Gate 12" } });
    fireEvent.keyDown(field(), { key: "Enter" });

    expect(await screen.findByText("Gate 12")).toBeTruthy();
  });

  it("keeps the field editable while a message is in flight", async () => {
    const { ChatThread, hold } = mount(() => seat());
    render(<ChatThread endpoint="/thread" />);
    await screen.findByText(EN_US_CHAT_UI_COPY.emptyTitle);

    const release = hold("POST /messages");
    fireEvent.change(field(), { target: { value: "Gate 12" } });
    fireEvent.click(screen.getByTestId("chat-send"));

    expect(await screen.findByText(EN_US_CHAT_UI_COPY.sending)).toBeTruthy();
    expect(field().readOnly).toBe(false);
    expect(field().disabled).toBe(false);

    await act(async () => release());
    expect(await screen.findByText("Gate 12")).toBeTruthy();
  });

  it("sends a quick reply and refuses contact information with the server's sentence", async () => {
    const { ChatThread } = mount(() => agent);
    render(<ChatThread endpoint="/thread" />);

    fireEvent.click(await screen.findByText("I have arrived."));
    await waitFor(() => expect(screen.getAllByText("I have arrived.")).toHaveLength(2));

    fireEvent.change(field(), { target: { value: "ana@example.com" } });
    fireEvent.click(screen.getByTestId("chat-send"));
    expect(await screen.findByText(/phone numbers, e-mail addresses, links and social profiles/)).toBeTruthy();
  });

  it("turns read-only when a send finds the thread closed mid-session", async () => {
    const writable = vi.fn().mockReturnValueOnce(seat()).mockReturnValue(seat({ canWrite: false }));
    const { ChatThread } = mount(writable);
    render(<ChatThread endpoint="/thread" />);
    await screen.findByText(EN_US_CHAT_UI_COPY.emptyTitle);

    fireEvent.change(field(), { target: { value: "Gate 12" } });
    fireEvent.click(screen.getByTestId("chat-send"));

    expect(await screen.findByText(EN_US_CHAT_UI_COPY.closed)).toBeTruthy();
  });

  it("turns read-only when the caller may no longer write", async () => {
    const { ChatThread } = mount(() => seat({ canWrite: false }));
    render(<ChatThread endpoint="/thread" />);
    expect(await screen.findByText(EN_US_CHAT_UI_COPY.closed)).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId("chat-input")).toBeNull());
  });
});
