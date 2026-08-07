/**
 * The boundary's MECHANICS, with a fallback that has no product in it.
 *
 * A host's own configuration — its fallback copy, and whatever test id its e2e
 * specs select on — belongs in that host's suite, not here. The split is on
 * purpose: these cases must pass for every consumer, and a fixture borrowed
 * from one of them would quietly encode that one host's choices.
 */
import { render, screen, waitFor } from "@testing-library/react";
import type { JSX } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createRouteErrorBoundary,
  type RouteCrashFallbackProps,
} from "../react/error-boundary";

/** A page that renders — the healthy case. */
function GoodPage(): JSX.Element {
  return <p>conteudo da pagina</p>;
}

/** A page that throws on render — a crashed chunk, or a page bug. */
function BadPage(): JSX.Element {
  throw new Error("chunk exploded");
}

function fallback({ error, reload, reset }: RouteCrashFallbackProps): JSX.Element {
  return (
    <div data-testid="crash">
      <span>{error.message}</span>
      <button type="button" onClick={reload}>
        recarregar
      </button>
      <button type="button" onClick={reset}>
        tentar de novo
      </button>
    </div>
  );
}

beforeEach(() => {
  // React logs the caught error itself, and the boundary adds its own line for
  // a support call. Silence both so a passing run is quiet.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createRouteErrorBoundary", () => {
  it("renders the children when nothing throws", () => {
    const RouteErrorBoundary = createRouteErrorBoundary({ fallback, onCrash: vi.fn() });
    render(
      <RouteErrorBoundary resetKey="a">
        <GoodPage />
      </RouteErrorBoundary>,
    );
    expect(screen.getByText("conteudo da pagina")).toBeDefined();
  });

  it("renders the host's fallback instead of blanking the tree", () => {
    const RouteErrorBoundary = createRouteErrorBoundary({ fallback, onCrash: vi.fn() });
    render(
      <RouteErrorBoundary resetKey="a">
        <BadPage />
      </RouteErrorBoundary>,
    );
    expect(screen.getByTestId("crash")).toBeDefined();
    expect(screen.getByText("chunk exploded")).toBeDefined();
  });

  it("reports the crash with the component stack", () => {
    const onCrash = vi.fn();
    const RouteErrorBoundary = createRouteErrorBoundary({ fallback, onCrash });
    render(
      <RouteErrorBoundary resetKey="a">
        <BadPage />
      </RouteErrorBoundary>,
    );
    expect(onCrash).toHaveBeenCalledTimes(1);
    const [error, componentStack] = onCrash.mock.calls[0] as [Error, string];
    expect(error.message).toBe("chunk exploded");
    // The component trace is the part a bare stack does not carry, and the
    // reason the boundary reports rather than letting the global handler do it.
    expect(componentStack).toContain("BadPage");
  });

  it("clears the error when the reset key changes", async () => {
    const RouteErrorBoundary = createRouteErrorBoundary({ fallback, onCrash: vi.fn() });
    const view = render(
      <RouteErrorBoundary resetKey="a">
        <BadPage />
      </RouteErrorBoundary>,
    );
    expect(screen.getByTestId("crash")).toBeDefined();

    // Navigating away must not carry the previous page's failure along.
    view.rerender(
      <RouteErrorBoundary resetKey="b">
        <GoodPage />
      </RouteErrorBoundary>,
    );
    await waitFor(() => {
      expect(screen.queryByTestId("crash")).toBeNull();
    });
    expect(screen.getByText("conteudo da pagina")).toBeDefined();
  });

  it("latches on a re-render that does NOT change the reset key", () => {
    const RouteErrorBoundary = createRouteErrorBoundary({ fallback, onCrash: vi.fn() });
    const view = render(
      <RouteErrorBoundary resetKey="a">
        <BadPage />
      </RouteErrorBoundary>,
    );
    // Same key, healthy children: the fallback must STAY. Clearing here would
    // mean any parent re-render re-mounts the page that just crashed, which
    // loops on a deterministic failure.
    view.rerender(
      <RouteErrorBoundary resetKey="a">
        <GoodPage />
      </RouteErrorBoundary>,
    );
    expect(screen.getByTestId("crash")).toBeDefined();
  });
});
