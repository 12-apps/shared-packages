import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

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

describe("the native thread", () => {
  it("renders with the native primitives, sends free text, and shows it under the role label", async () => {
    const harness = routedFetch(() => seat());
    const { ChatThread } = createNativeChat({ fetch: harness.fetch, copy: EN_US_CHAT_UI_COPY, formatTime });
    render(<ChatThread endpoint="/thread" />);
    expect(await screen.findByText(EN_US_CHAT_UI_COPY.emptyTitle)).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText(EN_US_CHAT_UI_COPY.placeholder), { target: { value: "Gate 12" } });
    fireEvent.click(screen.getByTestId("chat-send"));

    await waitFor(() => expect(screen.getByText("Gate 12")).toBeTruthy());
    expect(screen.getByText("Client")).toBeTruthy();
  });

  it("sends a quick reply and refuses contact information with the server's sentence", async () => {
    const harness = routedFetch(() => agent);
    const { ChatThread } = createNativeChat({ fetch: harness.fetch, copy: EN_US_CHAT_UI_COPY, formatTime });
    render(<ChatThread endpoint="/thread" />);

    fireEvent.click(await screen.findByText("I have arrived."));
    await waitFor(() => expect(screen.getAllByText("I have arrived.")).toHaveLength(2));

    fireEvent.change(screen.getByPlaceholderText(EN_US_CHAT_UI_COPY.placeholder), { target: { value: "ana@example.com" } });
    fireEvent.click(screen.getByTestId("chat-send"));
    expect(await screen.findByText(/phone numbers, e-mail addresses, links and social profiles/)).toBeTruthy();
  });

  it("turns read-only when the caller may no longer write", async () => {
    const harness = routedFetch(() => seat({ canWrite: false }));
    const { ChatThread } = createNativeChat({ fetch: harness.fetch, copy: EN_US_CHAT_UI_COPY, formatTime });
    render(<ChatThread endpoint="/thread" />);
    expect(await screen.findByText(EN_US_CHAT_UI_COPY.closed)).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId("chat-input")).toBeNull());
  });
});
