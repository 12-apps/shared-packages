import { Component, Suspense, lazy, type ComponentType, type JSX, type LazyExoticComponent, type ReactNode } from "react";

import { useCheckoutComponents, type CheckoutLazy } from "../ui";

/** What a part is rendered with to load it and draw nothing (`Preload`). */
interface Probe {
  readonly probe: true;
}

/** How long a part that failed to load waits before its one retry. */
export const PART_RETRY_MS = 1000;

/**
 * Catches a part whose chunk failed to load (FUT-3711): draws `fallback` in
 * its place — the rest of the list stays — and, with `retry` (the part's
 * `useForget()`), forgets the failed load and tries ONCE more after
 * {@link PART_RETRY_MS}, importing again rather than replaying the error.
 */
export class PartBoundary extends Component<{ fallback: ReactNode; retry?: () => void; children: ReactNode }, { failed: boolean; tries: number }> {
  state = { failed: false, tries: 0 };
  private timer: ReturnType<typeof setTimeout> | null = null;

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(): void {
    const { retry } = this.props;
    if (!retry || this.state.tries > 0) return;
    this.timer = setTimeout(() => {
      retry();
      this.setState({ failed: false, tries: 1 });
    }, PART_RETRY_MS);
  }

  componentWillUnmount(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** The part as loaded, answering a probe with nothing. */
function probed<P extends object>(Part: ComponentType<P>): ComponentType<P | Probe> {
  return function ProbedPart(props: P | Probe): JSX.Element | null {
    return "probe" in props ? null : <Part {...(props as P)} />;
  };
}

/** A part of the list loaded as a chunk of its own — see {@link deferredPart}. */
interface DeferredPart<P extends object> {
  /** The part, built through the host's loader; it suspends until its chunk has landed. */
  usePart: () => LazyExoticComponent<ComponentType<P | Probe>>;
  /** Drops this host loader's build, so the next render imports again — a `PartBoundary`'s `retry`. */
  useForget: () => () => void;
  /**
   * Starts the part's load through the same loader, drawing nothing: render it
   * as soon as the list knows it MAY draw the part, so the part is in hand
   * when it does — and never suspends where it would push the rows down.
   */
  Preload: () => JSX.Element;
}

/**
 * A part of the list loaded as a chunk of its own (FUT-3711), through the
 * host's `lazy` slot — its stale-chunk-safe loader — or React's `lazy` when the
 * host fills none.
 *
 * Each loader builds the deferred component ONCE and keeps it, keyed by the
 * loader itself: a component made on every render would be a new type every
 * render, remounting the part and suspending it again each time. A load that
 * fails is dropped from that cache — by the import's own rejection, and by the
 * part's `PartBoundary` retry for a failure in the host's loader around it —
 * so the retry imports again instead of rethrowing a rejection kept forever.
 */
export function deferredPart<P extends object>(load: () => Promise<ComponentType<P>>): DeferredPart<P> {
  const made = new WeakMap<CheckoutLazy, LazyExoticComponent<ComponentType<P | Probe>>>();
  function build(loader: CheckoutLazy): LazyExoticComponent<ComponentType<P | Probe>> {
    const part = loader(() =>
      load().then(
        (Part) => ({ default: probed(Part) }),
        (error: unknown) => {
          made.delete(loader);
          throw error;
        },
      ),
    );
    made.set(loader, part);
    return part;
  }
  function usePart(): LazyExoticComponent<ComponentType<P | Probe>> {
    const loader = useCheckoutComponents().lazy ?? lazy;
    return made.get(loader) ?? build(loader);
  }
  function useForget(): () => void {
    const loader = useCheckoutComponents().lazy ?? lazy;
    return () => made.delete(loader);
  }
  function Preload(): JSX.Element {
    const Part = usePart();
    return (
      <PartBoundary fallback={null}>
        <Suspense fallback={null}>
          <Part probe />
        </Suspense>
      </PartBoundary>
    );
  }
  return { usePart, useForget, Preload };
}
