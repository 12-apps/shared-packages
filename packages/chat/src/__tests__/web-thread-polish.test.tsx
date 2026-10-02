import { useUiTheme } from "@12-apps/ui/provider";
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { EN_US_CHAT_UI_COPY } from "../client/en-US";
import { createWebChat } from "../react/index";
import { ownBubbleTint } from "../ui/bubble-tint";
import { seat } from "./fixtures";
import { formatTime, replyWith, routedFetch, seedMessage } from "./surface-harness";

/**
 * The web thread's surface details: whose bubble is whose, where focus goes
 * after a send, what the field and the list tell assistive technology, the
 * closed thread with nothing in it, and marking read only once SEEN.
 */

const field = (): HTMLInputElement => screen.getByLabelText(EN_US_CHAT_UI_COPY.placeholder) as HTMLInputElement;
const bubbleOf = (id: string): HTMLElement => screen.getByTestId(`chat-message-${id}`).firstElementChild as HTMLElement;

class NoResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** jsdom has no IntersectionObserver: this one reports only when the test says so. */
class ScriptedIntersectionObserver {
  static readonly live: ScriptedIntersectionObserver[] = [];
  readonly targets: Element[] = [];
  private readonly callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    ScriptedIntersectionObserver.live.push(this);
  }

  observe(target: Element): void {
    this.targets.push(target);
  }

  unobserve(): void {}

  disconnect(): void {
    this.targets.length = 0;
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  /** The list scrolled into (or out of) view. */
  report(visible: boolean): void {
    const entry = { isIntersecting: visible, intersectionRatio: visible ? 0.5 : 0, target: this.targets[0] };
    this.callback([entry as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", NoResizeObserver);
  vi.stubGlobal("IntersectionObserver", ScriptedIntersectionObserver);
});
beforeEach(() => {
  ScriptedIntersectionObserver.live.length = 0;
});
afterAll(() => {
  vi.unstubAllGlobals();
});

function mount(actor = () => seat()) {
  const harness = routedFetch(actor);
  const { ChatThread } = createWebChat({ fetch: harness.fetch, copy: EN_US_CHAT_UI_COPY, formatTime });
  return { harness, ChatThread };
}

/** The observer watching the message list, once the list has mounted. */
async function listObserver(): Promise<ScriptedIntersectionObserver> {
  const region = await screen.findByRole("region", { name: EN_US_CHAT_UI_COPY.messagesLabel });
  await waitFor(() => expect(ScriptedIntersectionObserver.live.some((observer) => observer.targets.includes(region))).toBe(true));
  return ScriptedIntersectionObserver.live.find((observer) => observer.targets.includes(region)) as ScriptedIntersectionObserver;
}

describe("the web thread's bubbles", () => {
  it("draws the reader's own bubble on a tint of the theme's primary colour, and the others' on paper", async () => {
    const { ChatThread, harness } = mount();
    seedMessage(harness.db, { id: "m-mine", role: "client", body: "Gate 12", createdAt: "2026-10-02T11:50:00.000Z" });
    seedMessage(harness.db, { id: "m-theirs", body: "Downstairs now", createdAt: "2026-10-02T11:55:00.000Z" });
    render(<ChatThread endpoint="/thread" />);
    await screen.findByText("Downstairs now");

    const tint = ownBubbleTint(renderHook(() => useUiTheme()).result.current);
    expect(getComputedStyle(bubbleOf("m-mine")).backgroundColor).toBe(tint);
    expect(getComputedStyle(bubbleOf("m-theirs")).backgroundColor).not.toBe(tint);
    expect(getComputedStyle(bubbleOf("m-theirs")).backgroundColor).not.toBe("");
  });
});

describe("the web composer", () => {
  it("hands focus back to the field after a click on send", async () => {
    const { ChatThread } = mount();
    render(<ChatThread endpoint="/thread" />);
    await screen.findByText(EN_US_CHAT_UI_COPY.emptyTitle);

    fireEvent.change(field(), { target: { value: "Gate 12" } });
    fireEvent.click(screen.getByTestId("chat-send"));

    expect(await screen.findByText("Gate 12")).toBeTruthy();
    // The send button disables itself while the message is in flight; focus must not fall to the page.
    await waitFor(() => expect(document.activeElement).toBe(field()));
  });

  it("puts the role's length limit on the <input> itself", async () => {
    const { ChatThread } = mount();
    render(<ChatThread endpoint="/thread" />);
    await screen.findByText(EN_US_CHAT_UI_COPY.emptyTitle);

    expect(field().tagName).toBe("INPUT");
    expect(field().getAttribute("maxlength")).toBe("500");
  });
});

describe("the web message list", () => {
  it("announces arriving messages politely", async () => {
    const { ChatThread } = mount();
    render(<ChatThread endpoint="/thread" />);
    const list = await screen.findByRole("region", { name: EN_US_CHAT_UI_COPY.messagesLabel });

    expect(within(list).getByTestId("chat-messages-live").getAttribute("aria-live")).toBe("polite");
  });

  it("shows only the closed notice for a read-only thread nobody wrote in", async () => {
    const { ChatThread } = mount(() => seat({ canWrite: false }));
    render(<ChatThread endpoint="/thread" />);

    expect(await screen.findByTestId("chat-closed")).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId("chat-empty")).toBeNull());
    await waitFor(() => expect(screen.queryByTestId("chat-messages")).toBeNull());
  });

  it("still shows a read-only thread's messages above the closed notice", async () => {
    const { ChatThread, harness } = mount(() => seat({ canWrite: false }));
    seedMessage(harness.db, { id: "m-theirs", body: "Downstairs now", createdAt: "2026-10-02T11:55:00.000Z" });
    render(<ChatThread endpoint="/thread" />);

    expect(await screen.findByText("Downstairs now")).toBeTruthy();
    expect(screen.getByTestId("chat-closed")).toBeTruthy();
  });
});

describe('autoMarkRead="visible" on the web', () => {
  it("does not mark read while the list is off screen, and does once it scrolls into view", async () => {
    const onUnread = vi.fn();
    const { ChatThread, harness } = mount();
    seedMessage(harness.db, { id: "m-theirs", body: "Downstairs now", createdAt: "2026-10-02T11:55:00.000Z" });
    render(<ChatThread endpoint="/thread" autoMarkRead="visible" onUnreadChange={onUnread} />);

    const observer = await listObserver();
    act(() => observer.report(false));
    await waitFor(() => expect(onUnread).toHaveBeenCalledWith(1));
    // Let anything the load set off settle before asserting that nothing was marked.
    await act(async () => {});
    expect(harness.calls).toEqual(["GET /"]);

    act(() => observer.report(true));
    await waitFor(() => expect(onUnread).toHaveBeenLastCalledWith(0));
    expect(harness.bodies).toContainEqual({ key: "POST /read", body: { upTo: "2026-10-02T11:55:00.000Z" } });
  });

  it("marks a reload's unread at once while the list is on screen, and nothing twice", async () => {
    const { ChatThread, harness } = mount();
    const view = render(<ChatThread endpoint="/thread" autoMarkRead="visible" refreshSignal={0} />);
    const observer = await listObserver();
    act(() => observer.report(true));
    act(() => observer.report(false));
    act(() => observer.report(true));
    expect(harness.calls).toEqual(["GET /"]);

    seedMessage(harness.db, { id: "m-theirs", body: "Downstairs now", createdAt: "2026-10-02T11:55:00.000Z" });
    await act(async () => {
      view.rerender(<ChatThread endpoint="/thread" autoMarkRead="visible" refreshSignal={1} />);
    });

    expect(await screen.findByText("Downstairs now")).toBeTruthy();
    await waitFor(() => expect(harness.calls).toEqual(["GET /", "GET /", "POST /read"]));

    // Scrolling away and back over the same, already-marked load marks nothing again.
    act(() => observer.report(false));
    act(() => observer.report(true));
    await act(async () => {});
    expect(harness.calls).toEqual(["GET /", "GET /", "POST /read"]);
  });

  it("marks what an off-screen load showed when the list comes into view during a refresh that then fails", async () => {
    const onUnread = vi.fn();
    const { ChatThread, harness } = mount();
    seedMessage(harness.db, { id: "m-theirs", body: "Downstairs now", createdAt: "2026-10-02T11:55:00.000Z" });
    const view = render(<ChatThread endpoint="/thread" autoMarkRead="visible" refreshSignal={0} onUnreadChange={onUnread} />);
    const observer = await listObserver();
    act(() => observer.report(false));
    await waitFor(() => expect(onUnread).toHaveBeenCalledWith(1));

    const { answer, hold } = harness;
    answer("GET /", replyWith(503, { error: "unavailable", message: "Down" }));
    const release = hold("GET /");
    await act(async () => {
      view.rerender(<ChatThread endpoint="/thread" autoMarkRead="visible" refreshSignal={1} onUnreadChange={onUnread} />);
    });
    act(() => observer.report(true));
    await act(async () => {
      release();
    });

    await waitFor(() => expect(harness.bodies).toContainEqual({ key: "POST /read", body: { upTo: "2026-10-02T11:55:00.000Z" } }));
    expect(screen.getByText("Downstairs now")).toBeTruthy();
  });

  it("marks read at once where the browser has no IntersectionObserver", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    try {
      const { ChatThread, harness } = mount();
      seedMessage(harness.db, { id: "m-theirs", body: "Downstairs now", createdAt: "2026-10-02T11:55:00.000Z" });
      render(<ChatThread endpoint="/thread" autoMarkRead="visible" />);

      expect(await screen.findByText("Downstairs now")).toBeTruthy();
      await waitFor(() => expect(harness.calls).toContain("POST /read"));
    } finally {
      vi.stubGlobal("IntersectionObserver", ScriptedIntersectionObserver);
    }
  });
});
