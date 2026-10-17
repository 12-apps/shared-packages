import { Box, Divider } from "@mui/material";
import { useTheme } from "@mui/material/styles";
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

/**
 * Google Pay's own button (FUT-471's brand rule: the buyer presses Google's
 * button, drawn by `createButton`, never a look-alike) — black, "pay", a pill.
 * Its press opens the sheet SYNCHRONOUSLY, inside the tap, through `onPress`.
 */
function GoogleWalletButton({ client, onPress }: { client: GooglePaymentsClient; onPress: () => void }): JSX.Element {
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
  return <Box ref={mount} data-testid="list-google-pay" sx={{ height: (t) => t.spacing(WALLET_HEIGHT), "& > *": { width: "100%", height: "100%" } }} />;
}

/**
 * Apple's button: the `-apple-pay-button` appearance Safari draws in the
 * buyer's own language (Apple's Human Interface Guidelines), black, "pay".
 * Only a browser that has an `ApplePaySession` ever renders it; one that does
 * not know the appearance (a test browser with a stubbed session) gets the
 * accessible name drawn as text on the same black pill instead.
 */
function AppleWalletButton({ label, onPress }: { label: string; onPress: () => void }): JSX.Element {
  return (
    <Box
      component="button"
      type="button"
      aria-label={label}
      onClick={onPress}
      data-testid="list-apple-pay"
      sx={{
        WebkitAppearance: "-apple-pay-button",
        "-apple-pay-button-type": "pay",
        "-apple-pay-button-style": "black",
        height: (t) => t.spacing(WALLET_HEIGHT),
        width: "100%",
        border: 0,
        borderRadius: (t) => t.spacing(WALLET_HEIGHT / 2),
        cursor: "pointer",
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

/** One wallet's button, or nothing while the host re-prices it (the block then holds the place). */
function WalletButton({ wallet, cap, copy, onGoogle, onApple }: {
  wallet: ListWallet;
  cap: ListCapability;
  copy: PaymentListCopy;
  onGoogle: () => void;
  onApple: () => void;
}): JSX.Element {
  if (wallet === "GOOGLE_PAY" && cap.googlePay) return <GoogleWalletButton client={cap.googlePay.client} onPress={onGoogle} />;
  if (wallet === "APPLE_PAY") return <AppleWalletButton label={copy.wallets.applePay} onPress={onApple} />;
  // Google while the host re-prices: no sheet can open, so no Google button either — a plain held pill.
  return <HeldWalletButton label={copy.wallets.googlePay} />;
}

/** A held wallet while the host re-prices: the pill, disabled, named. */
function HeldWalletButton({ label }: { label: string }): JSX.Element {
  return (
    <Box
      component="button"
      type="button"
      disabled
      data-testid="list-wallet-held"
      sx={{ height: (t) => t.spacing(WALLET_HEIGHT), width: "100%", border: 0, borderRadius: (t) => t.spacing(WALLET_HEIGHT / 2), bgcolor: "common.black", color: "common.white", typography: "body1", fontWeight: 600 }}
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
          aria-disabled={held ? true : undefined}
          inert={held ? true : undefined}
          sx={{
            display: "grid",
            gap: 1.25,
            gridTemplateColumns: { xs: "minmax(0, 1fr)", sm: two ? "repeat(2, minmax(0, 1fr))" : "minmax(0, 1fr)" },
            opacity: (t) => (held ? t.palette.action.disabledOpacity : 1),
          }}
        >
          {cap.wallets.map((wallet) => (
            <WalletButton key={wallet} wallet={wallet} cap={cap} copy={copy} onGoogle={onGoogle} onApple={onApple} />
          ))}
        </Box>
        )}
        {held ? (
          <Text variant="body" size="sm" color="secondary" as="p" style={{ margin: 0 }} data-testid="list-wallets-held">
            {held}
          </Text>
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
