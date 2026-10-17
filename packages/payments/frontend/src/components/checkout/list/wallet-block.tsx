import { Box, Divider } from "@mui/material";
import { useTheme, type Theme } from "@mui/material/styles";
import { useEffect, useId, useRef, type JSX } from "react";

import { ChargeFailure } from "../card-view";
import { useCheckoutCopy } from "../copy-context";
import { UNRESOLVED_CODE } from "../failure-codes";
import type { GooglePaymentsClient } from "../google-pay-button";
import { useCheckoutComponents } from "../ui";

import type { ListChargeFailure } from "./charge-runners";
import { GroupHeading } from "./option-row";
import type { PaymentListCopy } from "./types";
import type { ListCapability, ListWallet } from "./use-capability";

/** The prototype's 44px wallet button (L3), on the theme's spacing scale. */
const WALLET_HEIGHT = 5.5;

/** Why the buttons are held, as each button carries it: disabled, and described by the reason. */
interface Held {
  /** The reason's element id, or `null` when nothing holds them. */
  describedBy: string | null;
}

/**
 * The pill's edge: none on a light page (the black pill is its own edge); a
 * hairline at night, where black on a dark surface has none; and a visible
 * one while held, when the pill is dimmed (FUT-3685 review).
 */
const pillEdge = (held: boolean) => (t: Theme): string => {
  if (held) return `1px solid ${t.palette.text.secondary}`;
  return t.palette.mode === "dark" ? `1px solid ${t.palette.divider}` : "1px solid transparent";
};

/**
 * The look every wallet pill shares — the prototype's 44px black pill (L3).
 * The edge is an OUTLINE drawn just inside the pill: it paints over Google's
 * own element and moves nothing, so both pills keep one size and their labels
 * one baseline.
 */
const pill = (held: boolean) => ({
  height: (t: Theme) => t.spacing(WALLET_HEIGHT),
  width: "100%",
  border: 0,
  outline: pillEdge(held),
  outlineOffset: "-1px",
  borderRadius: (t: Theme) => t.spacing(WALLET_HEIGHT / 2),
  overflow: "hidden",
} as const);

/**
 * Google Pay's own button (FUT-471's brand rule: the buyer presses Google's
 * button, drawn by `createButton`, never a look-alike) — black, "pay", a pill.
 * Its press opens the sheet SYNCHRONOUSLY, inside the tap, through `onPress`.
 * Held, Google's element is marked disabled and described by the reason —
 * it stays in the accessibility tree — and a press does nothing.
 */
function GoogleWalletButton({ client, onPress, held }: { client: GooglePaymentsClient; onPress: () => void; held: Held }): JSX.Element {
  const mount = useRef<HTMLDivElement | null>(null);
  const latest = useRef(onPress);
  latest.current = onPress;
  const locale = useCheckoutCopy().screens.wallet.googlePay.buttonLocale;
  const theme = useTheme();
  // Google's own parameter, in CSS pixels: half the button's height is a pill.
  const radius = Number.parseFloat(theme.spacing(WALLET_HEIGHT / 2));
  useEffect(() => {
    const element = mount.current;
    if (!element) return undefined;
    element.replaceChildren(
      client.createButton({
        onClick: () => latest.current(),
        buttonSizeMode: "fill",
        buttonLocale: locale,
        buttonColor: "black",
        buttonType: "pay",
        buttonRadius: radius,
      }),
    );
    return () => element.replaceChildren();
  }, [client, locale, radius]);
  useEffect(() => {
    const button = mount.current?.querySelector("button");
    if (!button) return;
    if (held.describedBy) {
      button.setAttribute("aria-disabled", "true");
      button.setAttribute("aria-describedby", held.describedBy);
    } else {
      button.removeAttribute("aria-disabled");
      button.removeAttribute("aria-describedby");
    }
  });
  const isHeld = held.describedBy !== null;
  return (
    <Box
      ref={mount}
      data-testid="list-google-pay"
      data-held={isHeld ? "true" : undefined}
      sx={{ ...pill(isHeld), pointerEvents: isHeld ? "none" : undefined, "& > *": { width: "100%", height: "100%" } }}
    />
  );
}

/**
 * Apple's button: the `-apple-pay-button` appearance Safari draws in the
 * buyer's own language (Apple's Human Interface Guidelines), black, "pay".
 * Only a browser that has an `ApplePaySession` ever renders it; one that does
 * not know the appearance (a test browser with a stubbed session) gets the
 * accessible name drawn as text on the same black pill instead.
 */
function AppleWalletButton({ label, onPress, held }: { label: string; onPress: () => void; held: Held }): JSX.Element {
  const isHeld = held.describedBy !== null;
  return (
    <Box
      component="button"
      type="button"
      aria-label={label}
      disabled={isHeld}
      aria-describedby={held.describedBy ?? undefined}
      onClick={onPress}
      data-testid="list-apple-pay"
      sx={{
        WebkitAppearance: "-apple-pay-button",
        "-apple-pay-button-type": "pay",
        "-apple-pay-button-style": "black",
        ...pill(isHeld),
        cursor: isHeld ? "default" : "pointer",
        bgcolor: "common.black",
        color: "common.white",
        typography: "body1",
        fontWeight: 600,
        "&:focus-visible": { outline: (t) => `${t.spacing(0.25)} solid ${t.palette.primary.main}`, outlineOffset: (t) => t.spacing(0.25) },
        "@supports (-webkit-appearance: -apple-pay-button)": { "& > span": { display: "none" } },
      }}
    >
      <span aria-hidden>{label}</span>
    </Box>
  );
}

/** One wallet's button, or a held pill while the host re-prices it. */
function WalletButton({ wallet, cap, copy, onGoogle, onApple, held }: {
  wallet: ListWallet;
  cap: ListCapability;
  copy: PaymentListCopy;
  onGoogle: () => void;
  onApple: () => void;
  held: Held;
}): JSX.Element {
  if (wallet === "GOOGLE_PAY" && cap.googlePay) return <GoogleWalletButton client={cap.googlePay.client} onPress={onGoogle} held={held} />;
  if (wallet === "APPLE_PAY") return <AppleWalletButton label={copy.wallets.applePay} onPress={onApple} held={held} />;
  // Google while the host re-prices: no sheet can open, so no Google button either — a plain held pill.
  return <HeldWalletButton label={copy.wallets.googlePay} held={held} />;
}

/** A held wallet while the host re-prices: the pill, disabled, named, described by the reason. */
function HeldWalletButton({ label, held }: { label: string; held: Held }): JSX.Element {
  return (
    <Box
      component="button"
      type="button"
      disabled
      aria-describedby={held.describedBy ?? undefined}
      data-testid="list-wallet-held"
      sx={{ ...pill(true), bgcolor: "common.black", color: "common.white", typography: "body1", fontWeight: 600 }}
    >
      {label}
    </Box>
  );
}

/**
 * "PAGAMENTO RÁPIDO" (FUT-3685, C5, C6, E4, E5, L3, L5): the ready wallets'
 * buttons above the list, then "ou escolha como pagar". Nothing at all — no
 * heading, no buttons, no divider — when no wallet is ready (E4); one wallet
 * takes the full width (E5); two sit side by side from the theme's `sm`
 * (L5) and stack below it (L3).
 *
 * The buttons are not part of the list's radio group (R1): pressing one opens
 * its sheet and never changes the chosen row. `held` is why they cannot act
 * yet — the CPF the provider needs (E3), the host re-pricing — said under them.
 */
export function WalletBlock({ cap, copy, held, failure, onGoogle, onApple }: {
  cap: ListCapability;
  copy: PaymentListCopy;
  held: string | null;
  /** The last wallet charge's refusal; an UNRESOLVED one removes the buttons (FUT-563). */
  failure: ListChargeFailure | null;
  onGoogle: () => void;
  onApple: () => void;
}): JSX.Element | null {
  const { Text } = useCheckoutComponents();
  const id = useId();
  const reasonId = `${id}-held`;
  if (cap.wallets.length === 0) return null;
  const two = cap.wallets.length > 1;
  const unresolved = failure?.code === UNRESOLVED_CODE;
  return (
    <Box data-testid="list-wallets" sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
      <Box role="group" aria-labelledby={id} sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
        <GroupHeading id={id}>{copy.wallets.heading}</GroupHeading>
        {unresolved ? null : (
        <Box
          data-testid="list-wallet-buttons"
          data-held={held ? "true" : undefined}
          sx={{
            display: "grid",
            gap: 1.25,
            gridTemplateColumns: { xs: "minmax(0, 1fr)", sm: two ? "repeat(2, minmax(0, 1fr))" : "minmax(0, 1fr)" },
            opacity: (t) => (held ? t.palette.action.disabledOpacity : 1),
          }}
        >
          {cap.wallets.map((wallet) => (
            <WalletButton key={wallet} wallet={wallet} cap={cap} copy={copy} onGoogle={onGoogle} onApple={onApple} held={{ describedBy: held ? reasonId : null }} />
          ))}
        </Box>
        )}
        {held ? (
          // The Text slot takes no id; the reason's own box carries the one the buttons point at.
          <Box id={reasonId} data-testid="list-wallets-held">
            <Text variant="body" size="sm" color="secondary" as="p" style={{ margin: 0 }}>
              {held}
            </Text>
          </Box>
        ) : null}
        {failure ? <ChargeFailure message={failure.message} unresolved={unresolved} /> : null}
      </Box>
      <Divider data-testid="list-wallets-or">
        {/* The body style the hints use: a caption tone fell under 4.5:1 on the surface. */}
        <Text variant="body" size="xs" color="secondary" as="span">
          {copy.wallets.or}
        </Text>
      </Divider>
    </Box>
  );
}
