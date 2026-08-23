/**
 * The Sentry self-check page (FUT-723).
 *
 * The page exists because every OTHER check in this feature can pass while
 * reporting is dead, so the load-bearing cases here are the two that decide
 * whether a human reads the truth off it:
 *
 * 1. the status panel reflects the LIVE SDK, not a re-fetched config — a page
 *    that showed a healthy DSN while the SDK never initialised would send
 *    somebody to debug the server for a browser problem;
 * 2. the render button throws where an error boundary can see it, because that
 *    is the path a real page crash takes and the only one that proves
 *    `reportRouteCrash` is wired.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  getClient: vi.fn(() => undefined as unknown),
  setTag: vi.fn(),
  withScope: vi.fn((fn: (scope: unknown) => void) => {
    fn({ setLevel: vi.fn(), setContext: vi.fn(), setTag: vi.fn(), setExtras: vi.fn() });
  }),
}));
vi.mock("@sentry/react", () => sentry);

import { Component, type ErrorInfo, type ReactNode } from "react";

import { ObservabilitySelfCheck } from "../react/self-check";
import { reportRouteCrash } from "../index";

/**
 * A minimal stand-in for whatever boundary wraps the page.
 *
 * Not `createRouteErrorBoundary`, even though the package now ships one: these
 * cases are about the PAGE, and a boundary with its own reset semantics and its
 * own reporting would make a failure here ambiguous between the two. What they
 * prove is narrow — a throw during RENDER reaches `componentDidCatch`, which
 * calls `reportRouteCrash` — and holds for any boundary. The real one is
 * covered in `route-error-boundary.test.tsx`, and which boundary a host mounts
 * stays the host's decision, injected through `createObservabilityPage`.
 */
class TestBoundary extends Component<{ children: ReactNode }, { crashed: boolean }> {
  override state = { crashed: false };

  static getDerivedStateFromError(): { crashed: boolean } {
    return { crashed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    reportRouteCrash(error, info.componentStack);
  }

  override render(): ReactNode {
    return this.state.crashed ? <div data-testid="route-error" /> : this.props.children;
  }
}

/** Stand in for an initialised client with the given options. */
function clientWith(options: Record<string, unknown>): void {
  sentry.getClient.mockReturnValue({ getOptions: () => options } as unknown);
}

beforeEach(() => {
  sentry.getClient.mockReturnValue(undefined as unknown);
  sentry.captureException.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ObservabilitySelfCheck", () => {
  it("reports the LIVE SDK state rather than a re-fetched config", () => {
    clientWith({
      dsn: "https://publickey@o1147893.ingest.us.sentry.io/4511854377238528",
      environment: "production",
      release: "89002e82",
    });

    render(<ObservabilitySelfCheck />);

    const panel = screen.getByTestId("self-check-status");
    expect(panel.textContent).toContain("initialised");
    expect(panel.textContent).toContain("production");
    expect(panel.textContent).toContain("89002e82");
  });

  it("masks the public key but keeps the project id", () => {
    // The project id is the whole diagnostic value of showing the DSN at all —
    // it is what tells you WHICH Sentry project this build reports to, which is
    // exactly the pairing that broke. The key adds nothing and is not shown.
    clientWith({ dsn: "https://abc123secret@o1147893.ingest.us.sentry.io/4511854377238528" });

    render(<ObservabilitySelfCheck />);

    const panel = screen.getByTestId("self-check-status");
    expect(panel.textContent).toContain("4511854377238528");
    expect(panel.textContent).not.toContain("abc123secret");
  });

  it("says plainly when reporting is OFF instead of looking healthy", () => {
    // No client at all — dev, CI, every PR build. If this rendered as normal,
    // the buttons below would silently do nothing and the page would be lying.
    render(<ObservabilitySelfCheck />);

    expect(screen.getByTestId("self-check-off")).toBeDefined();
    expect(screen.getByTestId("self-check-status").textContent).toContain("NOT initialised");
  });

  it("throws during RENDER so an error boundary catches it", () => {
    // The path that matters. A throw inside the click handler would never reach
    // a boundary — boundaries only see render — so a button that merely called
    // captureException would prove nothing about reportRouteCrash.
    clientWith({ dsn: "https://k@o1.ingest.sentry.io/1", environment: "production", release: "r" });
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <TestBoundary>
        <ObservabilitySelfCheck />
      </TestBoundary>,
    );
    fireEvent.click(screen.getByTestId("self-check-render"));

    // The boundary rendered its fallback, which means it caught the throw and
    // therefore ran componentDidCatch -> reportRouteCrash.
    expect(screen.getByTestId("route-error")).toBeDefined();
    expect(sentry.captureException).toHaveBeenCalled();
  });

  it("keeps looking until the SDK initialises, instead of snapshotting at mount", async () => {
    // The regression this guards. Init is deliberately deferred behind a fetch
    // of /api/observability-config so reporting never gates first paint, so at
    // mount there is no client yet. Reading once would show a confident "NOT
    // initialised" forever on a perfectly healthy build — the exact lie this
    // page exists to expose, produced by the page itself.
    render(<ObservabilitySelfCheck />);
    expect(screen.getByTestId("self-check-status").textContent).toContain("NOT initialised");

    // The SDK finishes initialising a moment later, as it does in production.
    clientWith({ dsn: "https://k@o1.ingest.sentry.io/9", environment: "production", release: "r1" });

    // Assert on the RELEASE, not on "initialised" — "NOT initialised"
    // contains that substring, so the obvious assertion passes without the fix.
    await waitFor(() => {
      expect(screen.getByTestId("self-check-status").textContent).toContain("r1");
    });
    expect(screen.getByTestId("self-check-status").textContent).not.toContain("NOT initialised");
  });

  it("throttles repeated presses so one leaning finger is not a flood", async () => {
    clientWith({ dsn: "https://k@o1.ingest.sentry.io/1" });

    render(<ObservabilitySelfCheck />);
    fireEvent.click(screen.getByTestId("self-check-warning"));
    fireEvent.click(screen.getByTestId("self-check-warning"));

    await waitFor(() => {
      expect(screen.getByTestId("self-check-note").textContent).toContain("Wait");
    });
  });
});
