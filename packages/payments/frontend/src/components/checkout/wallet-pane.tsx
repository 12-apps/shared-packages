import { Box, Divider } from "@mui/material";
import { useState, type JSX } from "react";

import { CardView } from "./card-view";
import { GooglePayButton } from "./google-pay-button";
import { cardChain, cardTokenization, googlePayConfig } from "./method-capability";
import type { ProviderCheckoutScreenProps } from "./providers/types";
import { useCheckoutComponents } from "./ui";
import { useWalletCharge, type WalletCharge } from "./use-wallet-charge";

/**
 * The CARD pane with its wallet fast lane (FUT-471/472).
 *
 * A wallet is not a fourth method — it is another way of producing the CARD
 * instrument — so it renders INSIDE the card pane, above the form, and only
 * when the chain head both declared the wallet capability and published the
 * parameters the browser needs (`googlePayConfig`, fail-closed). A store with
 * no wallet renders exactly the card view it always did.
 *
 * One pane owns BOTH submit paths' visibility so they cannot invite a double
 * payment: while a wallet charge is in flight or being confirmed, the card
 * form and every wallet button are REPLACED by the processing state — the same
 * rule `card-view.tsx` applies to its own pay bar, one level up.
 */

/** Post-submit confirmation, error > timeout > spinner — the card view's order. */
function WalletProcessing({ wallet }: { wallet: WalletCharge }): JSX.Element {
  const { Alert, LoadingState } = useCheckoutComponents();
  if (wallet.pollError) {
    return (
      <Alert
        variant="danger"
        title="Não foi possível confirmar o pagamento"
        description={wallet.pollError}
        showIcon
        data-testid="wallet-poll-error"
      />
    );
  }
  if (wallet.pollTimedOut) {
    return (
      <Alert
        variant="warning"
        title="O pagamento está demorando mais que o esperado"
        description="Você pode aguardar ou verificar seu pedido em instantes — não realize um novo pagamento."
        showIcon
        data-testid="wallet-poll-timeout"
      />
    );
  }
  return (
    <LoadingState
      variant="spinner"
      size="md"
      message="Processando pagamento…"
      dataTestId="wallet-processing"
    />
  );
}

/**
 * An UNRESOLVED wallet charge (FUT-563): some provider may be holding the
 * buyer's money, so the pane shows the warning and NO pay control of any kind
 * — no wallet button, no card form. Same presentation rule as the card view's
 * own unresolved state.
 */
function WalletUnresolved({ message }: { message: string }): JSX.Element {
  const { Alert } = useCheckoutComponents();
  return (
    <Alert
      variant="warning"
      title="Estamos confirmando seu pagamento"
      description={message}
      showIcon
      data-testid="wallet-unresolved"
    />
  );
}

/**
 * The wallet buttons the store's chain head supports, or null when there are
 * none. Split out so the pane below stays under the function-size gate.
 */
function WalletButtons({
  props,
  wallet,
  onSheetError,
}: {
  props: ProviderCheckoutScreenProps & { order: NonNullable<ProviderCheckoutScreenProps["order"]> };
  wallet: WalletCharge;
  onSheetError: (message: string) => void;
}): JSX.Element | null {
  const { Text } = useCheckoutComponents();
  const googlePay = googlePayConfig(props.config);
  if (!googlePay) return null;
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      <GooglePayButton
        order={props.order}
        params={googlePay}
        onKey={(key) => void wallet.payWithKey("GOOGLE_PAY", key)}
        onError={onSheetError}
      />
      <Divider>
        <Text variant="caption" size="xs" color="secondary" as="span">
          ou pague com cartão
        </Text>
      </Divider>
    </Box>
  );
}

/** The CARD pane: wallet fast lane above, the card form below. */
export function WalletCardPane(
  props: ProviderCheckoutScreenProps & {
    order: NonNullable<ProviderCheckoutScreenProps["order"]>;
  },
): JSX.Element {
  const { Alert } = useCheckoutComponents();
  const { order, buyer, config, tenantSlug, onResolved, pollIntervalMs } = props;
  const wallet = useWalletCharge(order, buyer, onResolved, pollIntervalMs);
  // A sheet failure the wallet reported before any charge existed (pay.js
  // refused, the sheet errored) — shown beside the form, which stays usable.
  const [sheetError, setSheetError] = useState<string | null>(null);

  if (wallet.phase !== "idle") return <WalletProcessing wallet={wallet} />;
  if (wallet.unresolved) return <WalletUnresolved message={wallet.error ?? ""} />;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <WalletButtons props={props} wallet={wallet} onSheetError={setSheetError} />
      {wallet.error ? (
        <Alert
          variant="danger"
          title="Não foi possível pagar"
          description={wallet.error}
          showIcon
          data-testid="wallet-error"
        />
      ) : null}
      {sheetError && !wallet.error ? (
        <Alert
          variant="danger"
          title="Não foi possível pagar"
          description={sheetError}
          showIcon
          data-testid="wallet-sheet-error"
        />
      ) : null}
      <CardView
        order={order}
        buyer={buyer}
        providerConfig={cardTokenization(config)}
        providerChain={cardChain(config)}
        tenantSlug={tenantSlug}
        onResolved={onResolved}
        pollIntervalMs={pollIntervalMs}
      />
    </Box>
  );
}
