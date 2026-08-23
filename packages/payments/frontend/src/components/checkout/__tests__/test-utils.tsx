import {
  render as rtlRender,
  renderHook as rtlRenderHook,
  type RenderHookOptions,
  type RenderHookResult,
  type RenderOptions,
  type RenderResult,
} from "@testing-library/react";
import { createElement, type ComponentType, type JSX, type ReactElement, type ReactNode } from "react";

import { CheckoutCopyProvider } from "../copy-context";
import { PT_BR_CHECKOUT_COPY } from "../pt-BR";

/**
 * `render` and `renderHook`, wrapped in the copy provider a real host mounts
 * (FUT-760).
 *
 * The screens read their words from context and THROW without it,
 * deliberately — a fallback could only be the origin host's Portuguese. That
 * makes every suite rendering them a host, so they get what a host provides
 * rather than each file growing a wrapper of its own. `renderHook` is wrapped
 * for the same reason and not a different one: `useCheckoutController` reads
 * the buyer-gate complaints from this context, so a suite driving the hook is
 * as much a host as one rendering a screen.
 *
 * The pt-BR pack, because these suites assert on the sentences it produces:
 * wording that changed by accident still fails a test.
 *
 * A caller may still pass its OWN `wrapper` — several suites provide a client
 * or a navigate port — and it nests INSIDE this one rather than replacing it.
 * Replacing it is what a bare `{ wrapper }` did before, and the failure it
 * produced named the copy provider rather than the suite's own wrapper.
 */
type SuiteWrapper = ComponentType<{ children: ReactNode }>;

function hostWrapper(inner?: SuiteWrapper): SuiteWrapper {
  return function CheckoutHost({ children }: { children: ReactNode }): JSX.Element {
    return (
      <CheckoutCopyProvider copy={PT_BR_CHECKOUT_COPY}>
        {inner ? createElement(inner, null, children) : children}
      </CheckoutCopyProvider>
    );
  };
}

export function render(ui: ReactElement, options?: RenderOptions): RenderResult {
  return rtlRender(ui, { ...options, wrapper: hostWrapper(options?.wrapper) });
}

export function renderHook<Result, Props>(
  hook: (initialProps: Props) => Result,
  options?: RenderHookOptions<Props>,
): RenderHookResult<Result, Props> {
  return rtlRenderHook(hook, { ...options, wrapper: hostWrapper(options?.wrapper) });
}

export * from "@testing-library/react";
