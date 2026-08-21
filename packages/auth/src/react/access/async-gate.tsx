import type { JSX, ReactNode } from "react";

import { AsyncStateContainer } from "@12-apps/ui/data-display/AsyncStateContainer";
import { EmptyState } from "@12-apps/ui/data-display/EmptyState";
import { ErrorState } from "@12-apps/ui/data-display/ErrorState";

/**
 * The three states every access screen has, in one place.
 *
 * ## Why a gate rather than three `if`s per screen
 *
 * Every screen in this surface asks the server something before it can render:
 * which sign-in methods the store accepts, whether a link is still valid,
 * whether the account has a password yet. Nothing is decided in the browser.
 * That means each screen has the same three non-content outcomes — waiting,
 * nothing to show, the question failed — and writing them per screen is how one
 * of them ends up as a blank card.
 *
 * The EMPTY state here is not a placeholder. Each one is a real configuration a
 * store can be in: no sign-in method enabled at all, e-mail sign-in off,
 * sign-up closed, an account with no password yet. Those are not errors and
 * must not read as one — they get a way FORWARD, which is why `emptyAction` is
 * part of the shape rather than optional decoration.
 *
 * ## `data-state`, and why it is not `data-estado`
 *
 * The prototype marks this attribute `data-estado` with Portuguese values. This
 * package ships to hosts that are not Portuguese, and a pt-BR identifier in
 * shared code is precisely what the copy-portability gate rejects — it caught a
 * single Portuguese sentence in this package's own story fixtures. The
 * ATTRIBUTE is a test hook, which is developer-facing, so it is English here
 * and a pt-BR host reads exactly the same four values.
 */

/** What the gate is showing right now. */
export type AccessState = "loading" | "ready" | "empty" | "error";

export interface AccessGateProps {
  /** The question is still in flight. */
  loading?: boolean;
  /**
   * The question failed — a 5xx, a dropped connection.
   *
   * Distinct from `empty` on purpose: a store with no sign-in method enabled is
   * a configuration, and telling somebody "try again" about it would send them
   * round a loop that cannot resolve.
   */
  error?: string | null;
  /** Retry the question. Rendered inside the error state, never beside it. */
  onRetry?: () => void;
  /** The answer came back, and it has nothing in it for this screen. */
  empty?: boolean;
  /** What the empty state says. Required when `empty` can be true. */
  emptyTitle?: string;
  emptyDescription?: string;
  /**
   * The way out of the empty state.
   *
   * A dead end here is the failure mode this whole component exists to prevent:
   * "this store has no e-mail sign-up" with no onward path is a screen somebody
   * closes.
   *
   * A label and a handler rather than a node, because `EmptyState` renders its
   * own action and ignores children — passing a button as a child looked right
   * and rendered nothing, which is exactly the kind of silent drop this surface
   * cannot afford.
   */
  emptyAction?: { label: string; onClick: () => void };
  /** What the error state's retry button says. */
  retryLabel: string;
  /** What the error state says above it. */
  errorTitle: string;
  children: ReactNode;
}

/** Which state the props resolve to — the same order the container applies. */
export function accessState(props: {
  loading?: boolean;
  error?: string | null;
  empty?: boolean;
}): AccessState {
  if (props.loading) return "loading";
  if (props.error) return "error";
  if (props.empty) return "empty";
  return "ready";
}

/**
 * One access screen's body, wrapped in its three states.
 *
 * The marker sits on a wrapper rather than on the container, because the
 * container swaps its own subtree and a test asserting "which state is this
 * screen in" needs one element that is always there to read.
 */
export function AccessGate({
  loading,
  error,
  onRetry,
  empty,
  emptyTitle,
  emptyDescription,
  emptyAction,
  retryLabel,
  errorTitle,
  children,
}: AccessGateProps): JSX.Element {
  const state = accessState({ loading, error, empty });
  return (
    <div data-testid="access-gate" data-state={state}>
      <AsyncStateContainer
        isLoading={loading ?? false}
        error={error ?? null}
        isEmpty={empty ?? false}
        dataTestId="access-async"
        renderError={(message) => (
          <ErrorState
            title={errorTitle}
            message={message}
            retryLabel={retryLabel}
            {...(onRetry ? { onRetry } : {})}
            dataTestId="access-error"
          />
        )}
        renderEmpty={() => (
          <EmptyState
            title={emptyTitle ?? ""}
            {...(emptyDescription ? { description: emptyDescription } : {})}
            {...(emptyAction ? { primaryAction: emptyAction } : {})}
            dataTestId="access-empty"
          />
        )}
      >
        {children}
      </AsyncStateContainer>
    </div>
  );
}
