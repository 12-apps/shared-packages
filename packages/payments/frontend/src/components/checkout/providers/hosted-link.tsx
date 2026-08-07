/**
 * The screen for a store whose buyer finishes on the PROVIDER's page (FUT-596).
 *
 * Declared as `hosted-link` by any adapter of that shape — today InfinitePay.
 * There is no card form and no PIX pane here on purpose: this provider takes
 * neither on our page, and rendering either would offer a buyer something the
 * charge cannot honour.
 *
 * ## Why this screen renders no payable
 *
 * For a hand-off provider the pane never receives an `order`, and that is by
 * design rather than an omission. The controller raises the charge, sees a
 * `hostedCheckoutUrl` on the response and navigates — `handOverToProvider`
 * returns before `setOrder` (`use-checkout-controller.ts`), because the buyer
 * is leaving this page and parking the payable for the return leg matters more
 * than painting a pane they will not see. `hosted-return.ts` picks it back up.
 *
 * So the whole job here is the moment BEFORE that: the buyer has chosen a
 * method and the redirect is being prepared. Previously the pane rendered
 * `null` through that moment, which reads as a checkout that has stalled — the
 * screen tells them where they are going instead. Nothing here touches the
 * money path; the navigation and the parking are unchanged.
 */
import { Box } from "@mui/material";
import type { JSX } from "react";

import { useCheckoutComponents } from "../ui";

import type { ProviderCheckoutScreenProps } from "./types";

export function HostedLinkScreen({ method }: ProviderCheckoutScreenProps): JSX.Element | null {
  const { Text, LoadingState } = useCheckoutComponents();

  // Nothing chosen yet ⇒ the shell is still showing the picker. Same as every
  // other screen: the pane stays out of the way until there is something to say.
  if (!method) return null;

  return (
    <Box
      data-testid="checkout-hosted-handoff"
      sx={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "center", py: 4 }}
    >
      <LoadingState variant="spinner" message="Preparando o pagamento" size="md" />
      <Text variant="body" size="md" as="p">
        Você será levado à página segura do provedor para concluir o pagamento.
      </Text>
      <Text variant="caption" size="sm" as="p" color="secondary">
        Assim que terminar, você volta para cá e nós confirmamos o pedido.
      </Text>
    </Box>
  );
}
