import { Box } from "@mui/material";
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type JSX,
  type ReactNode,
} from "react";

import { useCheckoutCopy } from "./copy-context";

import type { PixStage } from "./pix-stage";
import type { PaymentMethod } from "./types";
import { useCheckoutComponents } from "./ui";

/**
 * The width of the Dados and confirmation steps, and of every non-PIX pane:
 * the content of the 720px column the checkout always had once its host's
 * 24px gutters are taken (672). A host that widens the checkout for the PIX
 * pane (FUT-3367) leaves everything else exactly as wide as before.
 */
export const STEP_COLUMN_MAX = 672;

/**
 * The payment step's half of the PIX pane's after-copy face (the 2026-10-06
 * Pix redesign): the flag that hides the method picker, and the way to the
 * card that replaces it — offered only when the store actually takes a card,
 * since with the picker hidden it is the buyer's only route there.
 */
export function usePaymentPixStage(
  choice: { offered: PaymentMethod[] | null; cardUnavailable: boolean },
  onMethodChange: (method: PaymentMethod) => void,
): PixStage {
  const [afterCopy, setAfterCopy] = useState(false);
  const cardOffered = (choice.offered === null || choice.offered.includes("CARD")) && !choice.cardUnavailable;
  const preferCard = useCallback(() => {
    setAfterCopy(false);
    onMethodChange("CARD");
  }, [onMethodChange]);
  return useMemo(
    () => ({ afterCopy, setAfterCopy, preferCard: cardOffered ? preferCard : undefined }),
    [afterCopy, cardOffered, preferCard],
  );
}

/**
 * Step 2 "Pagamento" — pick PIX or card and pay on the SAME page. Selecting a
 * method auto-raises its order and reveals its UI (PIX QR / card form) with no
 * intermediate tap; switching method clears the previous order (controller).
 *
 * ## Unless the choice is not ours to ask
 *
 * A store that finishes checkout on the provider's own page gets NO picker
 * here (`methodChosenAtProvider`). Its screen renders a single "Seguir para o
 * pagamento" instead, and pressing it selects the store's hand-off method —
 * which is the same event a tile press is, so the auto-raise, the error panel
 * and the retry below all keep working unchanged. Preselection is suppressed
 * for the same flow, and deliberately: it exists to spare a buyer a tap that
 * buys them nothing, but here the tap is the buyer's consent to LEAVE, and
 * taking it for them would redirect a checkout the moment it rendered.
 */

/**
 * The checkout container's width class, from the 2026-10-11 Pagamento
 * redesign (FUT-3525): `wide` is the computer layout (the payment column with
 * the order summary beside it), `narrow` the phone layout (one column, chips,
 * a sticky pay bar).
 *
 * Read off the flow's own full-width root rather than the viewport, so a host
 * that renders the checkout inside a narrow panel gets the phone layout, and
 * picked ONCE for the whole flow so the header does not change shape between
 * steps.
 */
export const WIDE_CHECKOUT_MIN = 900;

/** The phone panel's padding, in px — the sticky pay bar reaches past it. */
export const PANEL_PAD_PHONE = 16;

interface CheckoutLayout {
  wide: boolean;
}

const CheckoutLayoutContext = createContext<CheckoutLayout | null>(null);

/** `null` outside a measured flow: a component composed by hand keeps its old look. */
export function useCheckoutLayout(): CheckoutLayout | null {
  return useContext(CheckoutLayoutContext);
}

export const CheckoutLayoutProvider = CheckoutLayoutContext.Provider;

/**
 * Measure an element's width and say whether it is the wide layout.
 *
 * A CALLBACK ref, so the measuring starts whenever the element mounts — the
 * flow renders its empty-cart screen first while the host's cart is still
 * loading, and a ref object read once in an effect would never see the frame
 * that mounts after it. Measured in a layout effect so the first PAINT is
 * already right; a width of zero (jsdom, a hidden tab) reads as narrow, which
 * is the layout that fits anything.
 */
export function useWideLayout(): [boolean, (element: HTMLElement | null) => void] {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [wide, setWide] = useState(false);
  useLayoutEffect(() => {
    if (!element) return;
    const measure = (): void => setWide(element.getBoundingClientRect().width >= WIDE_CHECKOUT_MIN);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return [wide, setElement];
}

/** The amount the phone's pay bar shows beside its button; set by the Pagamento step. */
const PayBarTotalContext = createContext<string | null>(null);

export const PayBarTotalProvider = PayBarTotalContext.Provider;

/**
 * The phone's sticky pay bar (FUT-3525): "Total" over the amount at its left,
 * the step's ONE primary action filling the rest, pinned to the bottom of the
 * viewport while the page scrolls. On the computer — or outside a measured
 * flow — it is just the action, where the pane put it.
 */
/**
 * The colour the page itself is painted, for a bar that must read as part of
 * the page. A host may paint its ground outside the theme (the storefront's
 * is the body's, while its `background.default` is white), so the theme role
 * is only the fallback until the first layout reads the real one.
 */
function usePageGround(): string | undefined {
  const [ground, setGround] = useState<string>();
  useLayoutEffect(() => {
    const painted = getComputedStyle(document.body).backgroundColor;
    if (painted && painted !== "rgba(0, 0, 0, 0)" && painted !== "transparent") setGround(painted);
  }, []);
  return ground;
}

export function StickyPayBar({
  children,
  dataTestId,
}: {
  children: ReactNode;
  dataTestId?: string;
}): JSX.Element {
  const layout = useCheckoutLayout();
  const totalLabel = useContext(PayBarTotalContext);
  const { Text } = useCheckoutComponents();
  const copy = useCheckoutCopy().screens.layout;
  const ground = usePageGround();
  if (!layout) return <Box data-testid={dataTestId}>{children}</Box>;
  if (layout.wide) {
    // The computer's action, in the panel: the prototype's 52px bold bar.
    return (
      <Box data-testid={dataTestId} sx={{ "& button": { minHeight: 52 }, "& button, & button *": { fontWeight: 700 } }}>
        {children}
      </Box>
    );
  }
  // The bar sits on the PAGE, not in the card around the pane (the
  // prototype's layout C): it reaches past the panel's padding and border on
  // three sides, so the card reads as ending above it.
  const breakout = `calc(-1 * (${PANEL_PAD_PHONE}px + 1px))`;
  return (
    <Box
      data-testid={dataTestId}
      sx={{
        position: "sticky",
        bottom: 0,
        zIndex: 2,
        mx: breakout,
        mb: breakout,
        mt: 1,
        // Its content on the column's edge, where the card's border was.
        px: "1px",
        pt: 1.5,
        // Clear of a phone's home indicator.
        pb: "calc(16px + env(safe-area-inset-bottom, 0px))",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        columnGap: 2,
        rowGap: 1,
        bgcolor: ground ?? "background.default",
      }}
    >
      {totalLabel ? (
        <Box sx={{ flex: "none", display: "flex", flexDirection: "column" }}>
          <Text variant="body" size="xs" as="span">
            {copy.total}
          </Text>
          <Box sx={{ "&& > *": { fontSize: "1.125rem", lineHeight: 1.2 } }}>
            <Text variant="body" size="md" weight="bold" as="span" data-testid="pay-bar-sticky-total">
              {totalLabel}
            </Text>
          </Box>
        </Box>
      ) : null}
      {/* The prototype's 56px pill with a bold label, never squeezed to two
          lines: under ~200px beside the total it wraps under it instead. */}
      <Box
        sx={{
          flex: "1 1 200px",
          minWidth: 0,
          "& button": { borderRadius: 999, minHeight: 56, whiteSpace: "nowrap" },
          "& button, & button *": { fontWeight: 700 },
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
