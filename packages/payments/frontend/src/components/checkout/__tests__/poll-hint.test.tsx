// @vitest-environment jsdom
/**
 * FUT-3205 — a realtime hint is not a re-arm.
 *
 * The pay step was bimodal: a paid buyer whose first `/status` ask raced the
 * webhook and lost got the hint a few hundred ms later, and the hint waited out
 * `poke`'s 1 s quiet window before asking again. `PollLoop.hint` answers it
 * by the loop's state instead:
 *
 *   - idle: ask now;
 *   - an ask in flight for under `REARM_QUIET_MS`: keep it, owe one more ask
 *     the moment it answers non-terminal;
 *   - an ask in flight for longer: supersede it within `claimRearm`'s budget,
 *     and with the budget spent, owe one more as above;
 *   - the wait ended (settled, stopped): nothing.
 *
 * A channel DROP keeps `wake`'s deferred retry, pinned here too.
 */
import { act, render } from "./test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { JSX } from "react";

import { CheckoutClientProvider } from "../client-context";
import { CheckoutLiveProvider, type CheckoutLiveSignal } from "../live-context";
import type { CheckoutClient } from "../transport";
import type { OrderStatus } from "../types";
import { usePaymentPolling } from "../use-payment-polling";
import type { Result } from "../../../result";

const PENDING: Result<OrderStatus> = { ok: true, data: "AWAITING_PAYMENT" };
const PAID: Result<OrderStatus> = { ok: true, data: "PAID" };

/**
 * A client whose asks are HELD until the test releases them, in order, or
 * answered at once when `instantly` is set. A container, not closed-over
 * `let`s (the flakiness gate's rule).
 */
function heldClient(): {
  client: CheckoutClient;
  calls: () => number;
  release: (answer: Result<OrderStatus>) => void;
  answerInstantly: (answer: Result<OrderStatus>) => void;
  answerAfter: (ms: number, answer: Result<OrderStatus>) => void;
} {
  const world = {
    asked: 0,
    held: [] as Array<(answer: Result<OrderStatus>) => void>,
    instant: null as Result<OrderStatus> | null,
    delayed: null as { ms: number; answer: Result<OrderStatus> } | null,
  };
  const client = {
    getStatus: () => {
      world.asked += 1;
      const instant = world.instant;
      if (instant) return Promise.resolve(instant);
      const delayed = world.delayed;
      if (delayed) return new Promise<Result<OrderStatus>>((resolve) => setTimeout(() => resolve(delayed.answer), delayed.ms));
      return new Promise<Result<OrderStatus>>((resolve) => world.held.push(resolve));
    },
  } as unknown as CheckoutClient;
  return {
    client,
    calls: () => world.asked,
    release: (answer) => world.held.pop()?.(answer),
    answerInstantly: (answer) => {
      world.instant = answer;
    },
    answerAfter: (ms, answer) => {
      world.delayed = { ms, answer };
    },
  };
}

/** The host's channel: who is listening, and a way to fire it. */
function channel(): { subscribe: CheckoutLiveSignal["subscribe"]; hint: () => void } {
  const listeners = new Set<() => void>();
  return {
    subscribe: (onHint) => {
      listeners.add(onHint);
      return () => listeners.delete(onHint);
    },
    hint: () => listeners.forEach((listener) => listener()),
  };
}

function Probe({ maxWaitMs }: { maxWaitMs?: number }): JSX.Element {
  const { status, timedOut } = usePaymentPolling("o1", { maxWaitMs });
  return <output data-status={status ?? ""} data-timed-out={String(timedOut)} />;
}

function Harness({
  client,
  signal,
  maxWaitMs,
}: {
  client: CheckoutClient;
  signal: CheckoutLiveSignal;
  maxWaitMs?: number;
}): JSX.Element {
  return (
    <CheckoutClientProvider client={client}>
      <CheckoutLiveProvider signal={signal}>
        <Probe maxWaitMs={maxWaitMs} />
      </CheckoutLiveProvider>
    </CheckoutClientProvider>
  );
}

async function elapse(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Something happens outside React, then the microtasks it queued run. */
async function outside(happen: () => void): Promise<void> {
  await act(async () => {
    happen();
    await vi.advanceTimersByTimeAsync(0);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a hint at an idle wait", () => {
  it("asks now, 50 ms after an ask answered AWAITING_PAYMENT, not a second later", async () => {
    const { client, calls, release } = heldClient();
    const { subscribe, hint } = channel();
    render(<Harness client={client} signal={{ live: true, subscribe }} />);
    await outside(() => release(PENDING));
    await elapse(50);

    await outside(hint);

    expect(calls()).toBe(2);
  });

  it("asks once per hint when hints are spaced wider than a 70 ms round trip", async () => {
    const { client, calls, answerAfter } = heldClient();
    answerAfter(70, PENDING);
    const { subscribe, hint } = channel();
    render(<Harness client={client} signal={{ live: true, subscribe }} />);
    await elapse(0);

    await elapse(150);
    await outside(hint);
    await elapse(150);
    await outside(hint);
    await elapse(150);
    await outside(hint);

    expect(calls()).toBe(4);
  });
});

describe("a hint while a young ask is in flight", () => {
  it("keeps the ask, and asks once more the moment it answers non-terminal", async () => {
    const { client, calls, release } = heldClient();
    const { subscribe, hint } = channel();
    render(<Harness client={client} signal={{ live: true, subscribe }} />);
    await elapse(50);

    await outside(hint);
    expect(calls()).toBe(1);

    await outside(() => release(PENDING));
    expect(calls()).toBe(2);
  });

  it("asks nothing more when that ask answers terminal", async () => {
    const { client, calls, release } = heldClient();
    const { subscribe, hint } = channel();
    render(<Harness client={client} signal={{ live: true, subscribe }} />);
    await elapse(50);
    await outside(hint);

    await outside(() => release(PAID));
    await elapse(20_000);

    expect(calls()).toBe(1);
  });

  it("costs one extra ask for three hints", async () => {
    const { client, calls, release } = heldClient();
    const { subscribe, hint } = channel();
    render(<Harness client={client} signal={{ live: true, subscribe }} />);
    await elapse(50);
    await outside(hint);
    await outside(hint);
    await outside(hint);

    await outside(() => release(PENDING));
    await elapse(100);

    expect(calls()).toBe(2);
  });
});

describe("what clears the mark", () => {
  it("an error answer still pays the owed ask, at once", async () => {
    const { client, calls, release } = heldClient();
    const { subscribe, hint } = channel();
    render(<Harness client={client} signal={{ live: true, subscribe }} />);
    await elapse(50);
    await outside(hint);

    await outside(() => release({ ok: false, error: "offline" }));

    expect(calls()).toBe(2);
  });

  it("a visibilitychange that supersedes the marked ask spends the mark", async () => {
    const { client, calls, release } = heldClient();
    const { subscribe, hint } = channel();
    render(<Harness client={client} signal={{ live: true, subscribe }} />);
    await elapse(500);
    await outside(hint);
    await elapse(700);
    // A second ask, sent after the hint: it answers for it.
    await outside(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(calls()).toBe(2);

    await outside(() => release(PENDING));
    await elapse(100);

    expect(calls()).toBe(2);
  });
});

describe("a hint while an old ask is in flight", () => {
  it("supersedes an ask over a second old at once", async () => {
    const { client, calls } = heldClient();
    const { subscribe, hint } = channel();
    render(<Harness client={client} signal={{ live: true, subscribe }} />);
    await elapse(1_100);

    await outside(hint);

    expect(calls()).toBe(2);
  });

  it("with the re-arm budget spent, keeps the ask and asks once more after it answers", async () => {
    const { client, calls, release } = heldClient();
    const { subscribe, hint } = channel();
    render(<Harness client={client} signal={{ live: true, subscribe }} />);
    // Three hung asks superseded, one second apart: the budget is spent.
    await elapse(1_100);
    await outside(hint);
    await elapse(1_100);
    await outside(hint);
    await elapse(1_100);
    await outside(hint);
    expect(calls()).toBe(4);

    await elapse(1_100);
    await outside(hint);
    expect(calls()).toBe(4);

    await outside(() => release(PENDING));
    expect(calls()).toBe(5);
  });
});

describe("a hint at a wait that has ended", () => {
  it("makes no ask after timedOut", async () => {
    const { client, calls, release } = heldClient();
    const { subscribe, hint } = channel();
    const view = render(<Harness client={client} signal={{ live: true, subscribe }} maxWaitMs={5_000} />);
    await outside(() => release(PENDING));
    await elapse(5_000);
    expect(view.container.querySelector("output")?.getAttribute("data-timed-out")).toBe("true");
    const before = calls();

    await outside(hint);
    await elapse(16_000);

    expect(calls()).toBe(before);
  });

  it("owes nothing for a mark the deadline overtook, sixteen seconds on", async () => {
    const { client, calls, release } = heldClient();
    const { subscribe, hint } = channel();
    const view = render(<Harness client={client} signal={{ live: true, subscribe }} maxWaitMs={5_000} />);
    await elapse(50);
    await outside(hint);
    await elapse(5_000);
    expect(view.container.querySelector("output")?.getAttribute("data-timed-out")).toBe("true");

    await outside(() => release(PENDING));
    await elapse(16_000);

    expect(calls()).toBe(1);
  });

  // FUT-3222: the answer to an ask the deadline overtook went straight on to
  // `scheduleNext`, which never ends a LIVE wait, so it kept asking behind the
  // timed-out panel for as long as the page stayed open.
  it("books no ask after an ask the LIVE deadline overtook answers non-terminal", async () => {
    const { client, calls, release } = heldClient();
    const { subscribe } = channel();
    const view = render(<Harness client={client} signal={{ live: true, subscribe }} maxWaitMs={5_000} />);
    await elapse(5_000);
    expect(view.container.querySelector("output")?.getAttribute("data-timed-out")).toBe("true");

    await outside(() => release(PENDING));
    await elapse(16_000);

    expect(calls()).toBe(1);
  });

  it("books no retry after an ask the LIVE deadline overtook answers an error", async () => {
    const { client, calls, release } = heldClient();
    const { subscribe } = channel();
    const view = render(<Harness client={client} signal={{ live: true, subscribe }} maxWaitMs={5_000} />);
    await elapse(5_000);

    await outside(() => release({ ok: false, error: "boom" }));
    await elapse(16_000);

    expect(calls()).toBe(1);
    expect(view.container.querySelector("output")?.getAttribute("data-timed-out")).toBe("true");
  });

  // Pins the ORDER of the FUT-3222 guard: checked before `absorb`, it would drop this PAID.
  it("still writes a PAID that the overtaken ask brings back", async () => {
    const { client, release } = heldClient();
    const { subscribe } = channel();
    const view = render(<Harness client={client} signal={{ live: true, subscribe }} maxWaitMs={5_000} />);
    await elapse(5_000);

    await outside(() => release(PAID));

    expect(view.container.querySelector("output")?.getAttribute("data-status")).toBe("PAID");
  });
});

describe("a channel that re-opens (FUT-3223)", () => {
  it("owes one more ask when it re-opens during an ask, so a pre-open answer is never the last word", async () => {
    const { client, calls, release } = heldClient();
    const { subscribe } = channel();
    const view = render(<Harness client={client} signal={{ live: false, subscribe }} maxWaitMs={600_000} />);
    await elapse(50);
    expect(calls()).toBe(1);

    view.rerender(<Harness client={client} signal={{ live: true, subscribe }} maxWaitMs={600_000} />);
    await elapse(0);
    expect(calls()).toBe(1);
    await outside(() => release(PENDING));

    expect(calls()).toBe(2);
    await outside(() => release(PAID));
    expect(view.container.querySelector("output")?.getAttribute("data-status")).toBe("PAID");
  });
});

describe("a channel that drops", () => {
  it("still asks one second after a drop that lands just after an answer, then at 2.5 s", async () => {
    const { client, calls, answerInstantly } = heldClient();
    answerInstantly(PENDING);
    const { subscribe } = channel();
    const view = render(<Harness client={client} signal={{ live: true, subscribe }} />);
    await elapse(50);
    expect(calls()).toBe(1);

    view.rerender(<Harness client={client} signal={{ live: false, subscribe }} />);
    await elapse(999);
    expect(calls()).toBe(1);
    await elapse(1);
    expect(calls()).toBe(2);

    await elapse(2_500);
    expect(calls()).toBe(3);
  });
});
