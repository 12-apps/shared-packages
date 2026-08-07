/**
 * WHERE a hosted handover sends the buyer (FUT-741).
 *
 * The handover is a full navigation to ANOTHER ORIGIN — a redirect provider's
 * page, or a 3-DS challenge — so it can never be the host's router. But it is
 * still a thing some hosts must observe: log it, confirm it, or render an
 * interstitial around it. Left as a bare `window.location.assign` inside the
 * controller it was none of those, and a browser that blocks or stalls the
 * navigation left the buyer on a page with nothing on it.
 *
 * So it is a port with a default. No provider ⇒ exactly today's behaviour.
 */
import { createContext, useContext, type JSX, type ReactNode } from "react";

/** Take the buyer to another origin. */
export type CheckoutNavigate = (url: string) => void;

/** The unchanged default: a full navigation, in this tab. */
const DEFAULT_NAVIGATE: CheckoutNavigate = (url) => {
  window.location.assign(url);
};

const CheckoutNavigateContext = createContext<CheckoutNavigate | null>(null);

export function CheckoutNavigateProvider({
  navigate,
  children,
}: {
  navigate: CheckoutNavigate;
  children: ReactNode;
}): JSX.Element {
  return (
    <CheckoutNavigateContext.Provider value={navigate}>{children}</CheckoutNavigateContext.Provider>
  );
}

/** The host's navigate port, or `window.location.assign`. */
export function useCheckoutNavigate(): CheckoutNavigate {
  return useContext(CheckoutNavigateContext) ?? DEFAULT_NAVIGATE;
}
