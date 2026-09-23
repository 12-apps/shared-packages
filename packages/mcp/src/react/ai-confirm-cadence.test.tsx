// @vitest-environment jsdom
import { PT_BR_MCP_AI_COPY } from "./pt-BR";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GuidedNav } from "@12-apps/onboarding";

import type { AiHostGuide } from "../guide";
import type { AiConnection } from "./ai-connection-utils";
import { ConfirmStep } from "./ai-flow-steps";

/**
 * How often the Confirmar step re-checks while it waits for the assistant.
 *
 * The wait ends when the selected host's connection appears. Out of the box it
 * re-checks every 3 s; a host that hears the connection arrive over its own
 * realtime channel passes a slower `pollIntervalMs` while that channel is live,
 * so the wait is carried by the hint and the interval is only the floor under
 * a lost one. It never stops while there is nothing to show.
 */

const CLAUDE: AiHostGuide = {
  id: "claude",
  label: "Claude.ai",
  brand: "claude",
  kind: "app web",
  steps: ["passo"],
};

const CONNECTED: AiConnection = {
  clientName: "Claude",
  host: "claude",
  lastActiveAt: new Date("2026-07-18T08:30:00.000Z"),
};

function makeNav(): GuidedNav {
  return {
    activeStepId: "confirm",
    data: { selectedHost: "claude" },
    pending: false,
    goTo: vi.fn(),
    next: vi.fn(),
    back: vi.fn(),
    complete: vi.fn(),
    restart: vi.fn(),
  };
}

/** Mount the step waiting (or not) for Claude, and count its re-checks. */
function mountStep(options: { pollIntervalMs?: number; connections?: readonly AiConnection[] }) {
  const onRetest = vi.fn();
  render(
    <ConfirmStep
      copy={PT_BR_MCP_AI_COPY}
      nav={makeNav()}
      connections={options.connections ?? []}
      hosts={[CLAUDE]}
      onRetest={onRetest}
      {...(options.pollIntervalMs === undefined ? {} : { pollIntervalMs: options.pollIntervalMs })}
    />,
  );
  return { rechecks: (): number => onRetest.mock.calls.length };
}

function elapse(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ConfirmStep — the wait's cadence", () => {
  it("re-checks every 3 s when the host says nothing", () => {
    const { rechecks } = mountStep({});

    elapse(3_000);

    expect(rechecks()).toBe(1);
  });

  it("re-checks at the host's interval when it passes one", () => {
    const { rechecks } = mountStep({ pollIntervalMs: 30_000 });

    elapse(3_000);
    expect(rechecks()).toBe(0);

    // Slower, never stopped: a lost hint still ends the wait on its own.
    elapse(27_000);
    expect(rechecks()).toBe(1);
  });

  it("stops re-checking once the connection is there", () => {
    const { rechecks } = mountStep({ connections: [CONNECTED] });

    elapse(30_000);

    expect(rechecks()).toBe(0);
  });
});
