/**
 * The gesture only acts on a sequence it OWNS (12-61).
 *
 * Every case here reproduces a defect an adversarial review proved on the
 * shipped 2.6.1, and each one ends the same way: the app reloads under somebody
 * who performed no gesture. They share one cause — the handlers acted on any
 * touch in the subtree rather than on the sequence `start()` accepted — so they
 * are pinned together.
 *
 * The failure that matters most is the first: `touchend` fires on the node the
 * sequence STARTED on, and a React re-render that unmounts that node mid-drag
 * (a settling query, a Suspense boundary swapping in content — both routine on
 * a menu screen) means the lift never reaches the host and `touchcancel` never
 * fires either. A tracker left `claimed` past the threshold then reloads on the
 * shopper's next tap.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PullToRefresh } from "../react/pull-to-refresh";

afterEach(cleanup);

const ALWAYS = (): boolean => true;

/** The host always supplies these; the indicator has no defaults by design. */
const MESSAGES = {
  pulling: "Puxe para atualizar",
  armed: "Solte para atualizar",
  refreshing: "Atualizando…",
  label: "Atualizar a tela",
};

/** A touch list the handlers can read `clientX`/`clientY` off. */
const touches = (points: { x: number; y: number }[]): Touch[] =>
  points.map((p) => ({ clientX: p.x, clientY: p.y }) as Touch);

function fire(
  node: Element | Document,
  type: string,
  points: { x: number; y: number }[],
  cancelable = true,
): boolean {
  const event = new Event(type, { bubbles: true, cancelable });
  Object.defineProperty(event, "touches", { value: touches(points) });
  return node.dispatchEvent(event);
}

/** Mounts the gesture over a child, with the platform gate forced open. */
function mountGesture(onRefresh: () => Promise<void>) {
  render(
    <PullToRefresh platform={ALWAYS} onRefresh={onRefresh} messages={MESSAGES}>
      <button type="button" data-testid="child">
        adicionar ao carrinho
      </button>
    </PullToRefresh>,
  );
  return { child: screen.getByTestId("child") };
}

/** Every step of a drag long enough to arm (~137px of travel past y=100). */
const ARMING_DRAG = [20, 40, 60, 80, 100, 120, 140, 160, 180, 200, 220, 240];

/** Drag from y=100 far enough past the threshold to arm. */
function pullToArmed(node: Element, cancelable = true): void {
  fire(node, "touchstart", [{ x: 100, y: 100 }]);
  ARMING_DRAG.forEach((dy) => {
    fire(node, "touchmove", [{ x: 100, y: 100 + dy }], cancelable);
  });
}

/**
 * Scroll the document, and put it back afterwards.
 *
 * This is the condition that makes the stale-claim reachable: with the page
 * scrolled down, `start()` REFUSES the next sequence — and a refusal that does
 * not also reset the tracker leaves the previous pull's claim standing, so the
 * refused sequence's lift releases it.
 */
function scrollDocument(top: number): void {
  const root = document.scrollingElement ?? document.documentElement;
  Object.defineProperty(root, "scrollTop", { value: top, configurable: true });
}

afterEach(() => {
  scrollDocument(0);
});

describe("a sequence the gesture never accepted", () => {
  it("does not refresh on a lift the gesture refused to start", async () => {
    // The production shape: the armed pull's target is detached by a re-render,
    // so its `touchend` never bubbles. The shopper then scrolls and taps.
    const onRefresh = vi.fn(async () => {});
    const { child } = mountGesture(onRefresh);

    await act(async () => {
      pullToArmed(child);
    });
    // The lift is LOST — nothing dispatches `touchend` for that sequence.

    // A later tap, with the page now scrolled: `start()` refuses it, so this
    // sequence is not ours and its lift must release nothing.
    scrollDocument(800);
    await act(async () => {
      fire(child, "touchstart", [{ x: 40, y: 400 }]);
      fire(child, "touchend", []);
    });

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("does not refresh on a lift from inside an opted-out region", async () => {
    const onRefresh = vi.fn(async () => {});
    render(
      <PullToRefresh platform={ALWAYS} onRefresh={onRefresh} messages={MESSAGES}>
        <button type="button" data-testid="child">
          adicionar ao carrinho
        </button>
        <div data-pull-refresh="off" data-testid="rail">
          <span data-testid="inside">carrossel</span>
        </div>
      </PullToRefresh>,
    );

    const child = screen.getByTestId("child");
    const inside = screen.getByTestId("inside");

    // Arm a real pull on the allowed area, then lose its lift.
    await act(async () => {
      pullToArmed(child);
    });

    // A tap inside the opted-out rail is refused by `start()` — and must not
    // release the claim the lost lift left behind.
    await act(async () => {
      fire(inside, "touchstart", [{ x: 100, y: 100 }]);
      fire(inside, "touchend", []);
    });

    expect(onRefresh).not.toHaveBeenCalled();
  });
});

describe("a refresh already in flight", () => {
  it("survives an impatient tap, and is not raised twice", async () => {
    // `reloadApp` waits up to 2s for the worker, so the page looks frozen and a
    // tap is the LIKELY input. It must not clear the latch.
    // A refresh that never settles, which is the state under test: on the real
    // path `reloadApp` is replacing the document, so the promise never resolves
    // there either. Nothing is captured across a callback boundary.
    const onRefresh = vi.fn(() => new Promise<void>(() => {}));
    const { child } = mountGesture(onRefresh);

    await act(async () => {
      pullToArmed(child);
      fire(child, "touchend", []);
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);

    // The browser cancels a touch while the spinner is up — a system gesture,
    // an incoming call. `cancel()` must still reset the tracker, so it is the
    // one `settle()` caller that CANNOT be ownership-guarded, and therefore the
    // path the "refreshing" guard exists for: without it the latch clears, the
    // spinner vanishes mid-reload and `start()` re-opens.
    await act(async () => {
      fire(child, "touchcancel", []);
    });
    const chip = child.ownerDocument.querySelector("[data-phase]");
    expect(chip?.getAttribute("data-phase")).toBe("refreshing");

    // So a second pull during the same refresh cannot raise a second reload.
    await act(async () => {
      pullToArmed(child);
      fire(child, "touchend", []);
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});

describe("a move the platform will not let us cancel", () => {
  it("hands the gesture back instead of claiming it", async () => {
    // WebKit marks the rest of a sequence non-cancelable once its rubber band
    // has started, which the deliberately-unprevented first 12px allow. Our
    // `preventDefault` is then inert, so claiming would paint a chip over the
    // browser's own bounce and reload on a gesture aimed at the document.
    const onRefresh = vi.fn(async () => {});
    const { child } = mountGesture(onRefresh);

    await act(async () => {
      pullToArmed(child, false);
      fire(child, "touchend", []);
    });

    expect(onRefresh).not.toHaveBeenCalled();
  });
});

describe("two mounts sharing one document", () => {
  it("gives the overscroll back only when the LAST one leaves", async () => {
    // Overlapping instances each capturing "what I found" is how `contain` gets
    // stranded on `html` — and on Android that is exactly the property holding
    // Chromium's own pull-to-refresh off, so the document ends up with no
    // reload gesture at all.
    const root = document.documentElement;
    root.style.overscrollBehaviorY = "";

    const first = render(
      <PullToRefresh platform={ALWAYS} messages={MESSAGES}>
        <span>um</span>
      </PullToRefresh>,
    );
    await act(async () => {});
    expect(root.style.overscrollBehaviorY).toBe("contain");

    const second = render(
      <PullToRefresh platform={ALWAYS} messages={MESSAGES}>
        <span>dois</span>
      </PullToRefresh>,
    );
    await act(async () => {});

    // The first one leaves; the second is still pulling, so it must stay held.
    await act(async () => {
      first.unmount();
    });
    expect(root.style.overscrollBehaviorY).toBe("contain");

    // The last one leaves — now the document gets its own behaviour back.
    await act(async () => {
      second.unmount();
    });
    expect(root.style.overscrollBehaviorY).toBe("");
  });
});
