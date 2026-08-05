import { Box } from "@mui/material";
import { useEffect, useState, type JSX } from "react";
import QRCode from "react-qr-code";

import { ContentCopyIcon } from "./icons";
import type { CheckoutOrder, OrderStatus, PixCharge } from "./types";
import { useCheckoutComponents } from "./ui";
import { usePaymentPolling } from "./use-payment-polling";

/**
 * PIX payment view: a scannable QR (rendered client-side from the "copia e cola"
 * payload), the copyable code, and a live pending indicator. Polls the order in
 * the background and hands a terminal status up to the parent, which then shows
 * the payment-status screen.
 */

/** The copyable "copia e cola" strip with its copy button. */
function PixCodeBox({ pix }: { pix: PixCharge }): JSX.Element {
  const { Button, Text } = useCheckoutComponents();
  const [copied, setCopied] = useState(false);

  const copyCode = async (): Promise<void> => {
    try {
      await navigator.clipboard?.writeText(pix.copyPaste);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — the code is still visible to copy manually */
    }
  };

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        width: "100%",
        maxWidth: 420,
        p: 1,
        borderRadius: 1,
        border: "1px solid",
        borderColor: "divider",
        bgcolor: "background.default",
      }}
    >
      <Text
        variant="code"
        size="xs"
        as="span"
        data-testid="pix-code"
        style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
      >
        {pix.copyPaste}
      </Text>
      <Button
        variant="outline"
        color="neutral"
        size="sm"
        icon={<ContentCopyIcon fontSize="small" />}
        onClick={() => {
          void copyCode();
        }}
        dataTestId="pix-copy"
      >
        {copied ? "Copiado!" : "Copiar"}
      </Button>
    </Box>
  );
}

/** The live footer: poll error, or the pulsing "awaiting payment" indicator. */
function PixPollFooter({ error }: { error: string | null }): JSX.Element {
  const { Alert, Text } = useCheckoutComponents();
  if (error) {
    return (
      <Alert
        variant="danger"
        title="Não foi possível confirmar o pagamento"
        description={error}
        showIcon
        data-testid="pix-poll-error"
      />
    );
  }
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, color: "text.secondary" }}>
      <LoadingDot />
      <Text variant="caption" size="xs" color="secondary" as="span" data-testid="pix-awaiting">
        Aguardando pagamento…
      </Text>
    </Box>
  );
}

export function PixView({
  order,
  onResolved,
  pollIntervalMs = 2500,
}: {
  order: CheckoutOrder;
  onResolved: (status: OrderStatus) => void;
  pollIntervalMs?: number;
}): JSX.Element {
  const { Text } = useCheckoutComponents();
  const { status, error } = usePaymentPolling(order.orderId, { intervalMs: pollIntervalMs });

  // Bubble a terminal status up once, so the parent can advance to the status step.
  useEffect(() => {
    if (status && status !== "AWAITING_PAYMENT") {
      onResolved(status);
    }
  }, [status, onResolved]);

  const pix = order.pix;
  if (!pix) {
    return (
      <Text variant="body" size="sm" color="danger" as="p" data-testid="pix-missing">
        Não foi possível gerar o código PIX.
      </Text>
    );
  }

  const validUntil = new Date(pix.expiresAt).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <Box
      data-testid="pix-view"
      sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, textAlign: "center" }}
    >
      <Text variant="heading" size="md" weight="bold" as="h2">
        Pague com PIX
      </Text>
      <Text variant="body" size="sm" color="secondary" as="p">
        Escaneie o QR code no app do seu banco ou copie o código. Total {order.totalLabel}.
      </Text>

      <Box
        data-testid="pix-qr"
        role="img"
        aria-label="QR Code PIX para pagamento"
        sx={{ bgcolor: "background.paper", p: 2, borderRadius: 2, border: "1px solid", borderColor: "divider" }}
      >
        <QRCode value={pix.copyPaste} size={200} />
      </Box>

      <PixCodeBox pix={pix} />

      <Text variant="caption" size="xs" color="secondary" as="p" data-testid="pix-expiry">
        Válido até {validUntil}. A confirmação é automática.
      </Text>

      <PixPollFooter error={error} />
    </Box>
  );
}

/** Small pulsing dot indicating the background poll is live. */
function LoadingDot(): JSX.Element {
  return (
    <Box
      aria-hidden
      sx={{
        width: 8,
        height: 8,
        borderRadius: "50%",
        bgcolor: "primary.main",
        animation: "pixPulse 1.2s ease-in-out infinite",
        "@keyframes pixPulse": {
          "0%, 100%": { opacity: 0.3 },
          "50%": { opacity: 1 },
        },
      }}
    />
  );
}
