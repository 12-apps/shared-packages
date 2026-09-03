/* eslint-disable test-flakiness/no-test-isolation -- `mocks` is the stub
   container, replaced wholesale in `beforeEach`; the rule flags the per-case
   reassignment anyway. */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { JSX } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PULL_GEOMETRY } from "../pull-gesture";
import { PT_BR_PULL_TO_REFRESH_MESSAGES } from "../pt-BR";
import { PullToRefresh } from "../react/pull-to-refresh";

/**
 * The mount: what the gesture does to the page around it (12-61).
 *
 * The arithmetic is asserted next door in `pull-gesture.test.ts`, against plain
 * points. What is left here is everything that only exists once it is in a
 * document — that it is INERT where the platform still has a reload, that a
 * claimed pull calls `preventDefault` and an undecided one does not, and that
 * the overscroll it borrows from the document is given back.
 */
const mocks = { onRefresh: vi.fn(), onDiagnostic: vi.fn() };

/** The travel that renders `distance` px, inverting the resistance curve. */
function travelFor(distance: number): number {
  return (distance * DEFAULT_PULL_GEOMETRY.maxPx) / (DEFAULT_PULL_GEOMETRY.maxPx - distance);
}

const ARMED_TRAVEL = travelFor(DEFAULT_PULL_GEOMETRY.thresholdPx) + 1;

/**
 * jsdom ships no `Touch` or `TouchEvent`, and the handlers read three things
 * off the event, so three things are what this fabricates.
 */
function touch(
  node: Element,
  type: "touchstart" | "touchmove" | "touchend" | "touchcancel",
  points: { x: number; y: number }[] = [],
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", {
    value: points.map((point) => ({ clientX: point.x, clientY: point.y })),
  });
  fireEvent(node, event);
  return event;
}

function setScrollTop(value: number): void {
  const root = document.scrollingElement ?? document.documentElement;
  Object.defineProperty(root, "scrollTop", { value, configurable: true });
}

function Subject(props: {
  platform?: () => boolean;
  enabled?: boolean;
  onRefresh?: () => void | Promise<unknown>;
}): JSX.Element {
  return (
    <PullToRefresh
      messages={PT_BR_PULL_TO_REFRESH_MESSAGES}
      platform={props.platform ?? ((): boolean => true)}
      enabled={props.enabled}
      onRefresh={props.onRefresh ?? mocks.onRefresh}
      onDiagnostic={mocks.onDiagnostic}
    >
      <p>cardápio</p>
    </PullToRefresh>
  );
}

/** Drags from the top of the page down by `travel`, and lifts. */
function pull(travel: number, sideways = 0): Event {
  const host = screen.getByTestId("pull-to-refresh");
  touch(host, "touchstart", [{ x: 100, y: 10 }]);
  const move = touch(host, "touchmove", [{ x: 100 + sideways, y: 10 + travel }]);
  touch(host, "touchend");
  return move;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.onRefresh = vi.fn().mockResolvedValue(undefined);
  mocks.onDiagnostic = vi.fn();
  setScrollTop(0);
});

describe("PullToRefresh", () => {
  it("renders its children whether or not the gesture is live", () => {
    render(<Subject platform={(): boolean => false} />);
    expect(screen.getByText("cardápio")).toBeDefined();
  });

  it("mounts no indicator where the platform still has a reload", async () => {
    render(<Subject platform={(): boolean => false} />);
    // The diagnostic is reported from the same effect that takes the decision,
    // so by the time it lands the mount is settled and nothing is still pending.
    await waitFor(() => {
      expect(mocks.onDiagnostic).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.queryByTestId("pull-to-refresh-indicator")).toBeNull();
    });
  });

  it("mounts the indicator where the platform took the reload away", async () => {
    render(<Subject />);
    expect(await screen.findByTestId("pull-to-refresh-indicator")).toBeDefined();
  });

  it("stays inert when the host's own gate is closed", async () => {
    render(<Subject enabled={false} />);
    await vi.waitFor(() => {
      expect(mocks.onDiagnostic).toHaveBeenCalledWith(
        "pwa: pull-to-refresh mounted",
        expect.objectContaining({ enabled: false, supported: true }),
      );
    });
    await waitFor(() => {
      expect(screen.queryByTestId("pull-to-refresh-indicator")).toBeNull();
    });
  });

  it("refreshes on a pull past the threshold", async () => {
    render(<Subject />);
    await screen.findByTestId("pull-to-refresh-indicator");
    pull(ARMED_TRAVEL);
    expect(mocks.onRefresh).toHaveBeenCalledTimes(1);
  });

  it("does not refresh on a pull that stops short", async () => {
    render(<Subject />);
    await screen.findByTestId("pull-to-refresh-indicator");
    pull(DEFAULT_PULL_GEOMETRY.engagePx + 4);
    expect(mocks.onRefresh).not.toHaveBeenCalled();
  });

  it("claims the gesture only once the pull is unmistakable", async () => {
    render(<Subject />);
    await screen.findByTestId("pull-to-refresh-indicator");
    // Undecided: the page must still be free to scroll under the finger.
    const undecided = pull(DEFAULT_PULL_GEOMETRY.engagePx - 1);
    expect(undecided.defaultPrevented).toBe(false);
    const claimed = pull(ARMED_TRAVEL);
    expect(claimed.defaultPrevented).toBe(true);
  });

  it("leaves a sideways swipe to the rail it started in", async () => {
    render(<Subject />);
    await screen.findByTestId("pull-to-refresh-indicator");
    const move = pull(40, 90);
    expect(move.defaultPrevented).toBe(false);
    expect(mocks.onRefresh).not.toHaveBeenCalled();
  });

  it("ignores a pull that starts below the top of the document", async () => {
    render(<Subject />);
    await screen.findByTestId("pull-to-refresh-indicator");
    setScrollTop(400);
    pull(ARMED_TRAVEL);
    expect(mocks.onRefresh).not.toHaveBeenCalled();
  });

  it("abandons the gesture when a second finger arrives", async () => {
    render(<Subject />);
    const host = screen.getByTestId("pull-to-refresh");
    await screen.findByTestId("pull-to-refresh-indicator");
    touch(host, "touchstart", [{ x: 100, y: 10 }]);
    touch(host, "touchmove", [{ x: 100, y: 10 + ARMED_TRAVEL }]);
    // A pinch-zoom, and zooming against a pinned page is a trap.
    touch(host, "touchmove", [
      { x: 100, y: 10 + ARMED_TRAVEL },
      { x: 200, y: 300 },
    ]);
    touch(host, "touchend");
    expect(mocks.onRefresh).not.toHaveBeenCalled();
  });

  it("borrows the document's top overscroll and gives it back", async () => {
    const view = render(<Subject />);
    await screen.findByTestId("pull-to-refresh-indicator");
    expect(document.documentElement.style.overscrollBehaviorY).toBe("contain");
    expect(document.body.style.overscrollBehaviorY).toBe("contain");
    view.unmount();
    expect(document.documentElement.style.overscrollBehaviorY).toBe("");
  });

  it("touches the document's overscroll not at all where it is inert", async () => {
    // Nothing resets this between cases on purpose: every mount before this one
    // was unmounted by the library's own cleanup, so a document still reading
    // `contain` here means the restore above leaked, which is worth failing on.
    render(<Subject platform={(): boolean => false} />);
    await waitFor(() => {
      expect(mocks.onDiagnostic).toHaveBeenCalled();
    });
    expect(document.documentElement.style.overscrollBehaviorY).toBe("");
  });

  it("reports a refresh that throws, rather than losing it", async () => {
    render(<Subject onRefresh={(): Promise<never> => Promise.reject(new Error("nope"))} />);
    await screen.findByTestId("pull-to-refresh-indicator");
    pull(ARMED_TRAVEL);
    await waitFor(() => {
      expect(mocks.onDiagnostic).toHaveBeenCalledWith(
        "pwa: pull-to-refresh failed",
        expect.objectContaining({ reason: "nope" }),
      );
    });
  });
});
