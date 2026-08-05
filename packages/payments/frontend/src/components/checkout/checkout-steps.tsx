import { Box } from "@mui/material";
import { useEffect, useRef, type JSX, type ReactNode } from "react";

import { BuyerInfoForm } from "./buyer-info-form";
import { CardView } from "./card-view";
import { LockOutlinedIcon } from "./icons";
import {
  cardChain,
  cardPathAvailable,
  cardTokenization,
  offeredMethods,
  usePreselectSoleMethod,
} from "./method-capability";
import { MethodPicker } from "./method-picker";
import { PaymentErrorPanel } from "./payment-error-panel";
import { PayerSummary } from "./payer-summary";
import { PixView } from "./pix-view";
import type {
  BuyerField,
  BuyerInfo,
  CheckoutOrder,
  CheckoutProviderConfig,
  OrderStatus,
  PaymentMethod,
} from "./types";
import { useCheckoutComponents } from "./ui";

/**
 * Auto-raise the order once per method-while-orderless (the ref also absorbs
 * StrictMode's double-effect, so PIX never double-charges); a failure sets
 * `createError` which stops the loop until the buyer retries.
 */
function useAutoRaiseOrder(
  order: CheckoutOrder | null,
  method: PaymentMethod | null,
  creating: boolean,
  createError: string | null,
  onGenerate: (method: PaymentMethod) => void,
): void {
  const requestedFor = useRef<PaymentMethod | null>(null);
  useEffect(() => {
    if (order) {
      requestedFor.current = null;
      return;
    }
    // No method chosen yet ⇒ show only the picker; raise the order once the
    // buyer selects PIX or card.
    if (!method || creating || createError || requestedFor.current === method) return;
    requestedFor.current = method;
    onGenerate(method);
  }, [method, order, creating, createError, onGenerate]);
}

/** The per-method payment body — PIX QR, card form, or nothing until raised. */
function PaymentBody({
  order,
  buyer,
  providerConfig,
  tenantSlug,
  onResolved,
  pollIntervalMs,
}: {
  order: CheckoutOrder | null;
  buyer: BuyerInfo;
  providerConfig: CheckoutProviderConfig | null;
  tenantSlug?: string;
  onResolved: (status: OrderStatus) => void;
  pollIntervalMs?: number;
}): JSX.Element | null {
  if (order?.method === "PIX") {
    return <PixView order={order} onResolved={onResolved} pollIntervalMs={pollIntervalMs} />;
  }
  if (order?.method === "CARD") {
    return (
      <CardView
        order={order}
        buyer={buyer}
        providerConfig={cardTokenization(providerConfig)}
        // The whole chain (FUT-563): one instrument is minted per provider so
        // the charge survives the first one failing, with nothing re-typed.
        providerChain={cardChain(providerConfig)}
        tenantSlug={tenantSlug}
        onResolved={onResolved}
        pollIntervalMs={pollIntervalMs}
      />
    );
  }
  return null;
}

/** Empty-cart state shown when there's nothing to check out. */
export function EmptyCart({ onBack }: { onBack: () => void }): JSX.Element {
  const { Button, Text } = useCheckoutComponents();
  return (
    <Box data-testid="checkout-empty" sx={{ py: 8, textAlign: "center", display: "flex", flexDirection: "column", gap: 2, alignItems: "center" }}>
      <Text variant="heading" size="md" as="p">
        Seu carrinho está vazio.
      </Text>
      <Button variant="solid" color="primary" size="md" onClick={onBack} dataTestId="checkout-empty-back">
        Ver cardápio
      </Button>
    </Box>
  );
}

/**
 * The totals shown on the pay bar: the comanda scope's when settling a comanda
 * (FUT-comandas), otherwise the cart's own — both supplied by the host, which
 * is the only side that knows either.
 */
function displayTotals(
  override: { label: string; items: number } | undefined,
  cart: { totalLabel: string; totalItems: number },
): { label: string; items: number } {
  return { label: override?.label ?? cart.totalLabel, items: override?.items ?? cart.totalItems };
}

/** The pay bar's money column: item count, grand total, host discount lines. */
function PayBarTotal({
  totalLabel,
  totalItems,
  children,
}: {
  totalLabel: string;
  totalItems: number;
  children?: ReactNode;
}): JSX.Element {
  const { Text } = useCheckoutComponents();
  return (
    <Box sx={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
      <Text variant="caption" size="xs" color="secondary" as="span">
        Total · {totalItems} {totalItems === 1 ? "item" : "itens"}
      </Text>
      <Text variant="heading" size="md" weight="bold" color="primary" as="span" data-testid="pay-bar-total">
        {totalLabel}
      </Text>
      {children}
    </Box>
  );
}

/**
 * Step 1 "Dados" — the buyer's register info (CPF plus optional name/email/
 * phone; contact pre-filled from the saved buyer profile). NO payment method
 * here (that's step 2); nav lives in the slim checkout header. "Continuar"
 * (sticky, with the live total) validates the CPF and advances to "Pagamento"
 * — no charge yet.
 */
export function DadosStep({
  buyer,
  onBuyerChange,
  saveProfile,
  onSaveProfileChange,
  createError,
  errorField,
  onContinue,
  cartTotals,
  discountLines,
  totalOverride,
}: {
  buyer: BuyerInfo;
  onBuyerChange: (buyer: BuyerInfo) => void;
  saveProfile: boolean;
  onSaveProfileChange: (value: boolean) => void;
  createError: string | null;
  errorField: BuyerField | null;
  onContinue: () => void;
  /** The host cart's own totals — what the pay bar shows in cart mode. */
  cartTotals: { totalLabel: string; totalItems: number };
  /**
   * The saving, itemized under the total the buyer is about to authorize
   * (FUT-246) — RENDERED BY THE HOST from its cart (the storefront passes its
   * cart footer's money block), never re-implemented here, so the two surfaces
   * can never word the same discount differently.
   */
  discountLines?: ReactNode;
  /** Comanda settlement (FUT-comandas): totals come from the comanda, not the cart. */
  totalOverride?: { label: string; items: number };
}): JSX.Element {
  const { ActionBar, Alert, Button, Checkbox, Text } = useCheckoutComponents();
  const { label: totalLabel, items: totalItems } = displayTotals(totalOverride, cartTotals);

  return (
    <>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 3, pb: { xs: createError ? 22 : 14, sm: createError ? 20 : 12 } }}>
        <BuyerInfoForm
          value={buyer}
          onChange={onBuyerChange}
          fieldError={errorField && createError ? { field: errorField, message: createError } : null}
        />
        <Checkbox
          checked={saveProfile}
          onChange={(_event, checked) => onSaveProfileChange(checked)}
          label="Salvar meus dados para a próxima compra"
          data-testid="buyer-save-profile"
        />
      </Box>

      <ActionBar dataTestId="checkout-pay-bar">
        <Box sx={{ width: "100%", display: "flex", flexDirection: "column", gap: 1.5 }}>
          {createError ? (
            <Alert variant="danger" title="Não foi possível continuar" description={createError} showIcon data-testid="checkout-error" />
          ) : null}
          <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
            <PayBarTotal totalLabel={totalLabel} totalItems={totalItems}>
              {/* Suppressed while settling a comanda: those totals come from
                  the frozen ticket, not the cart. */}
              {totalOverride ? null : discountLines}
            </PayBarTotal>
            <Box sx={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 0.5, minWidth: 0 }}>
              <Button variant="solid" color="primary" size="lg" fullWidth onClick={onContinue} dataTestId="checkout-continue">
                Continuar
              </Button>
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, color: "text.secondary" }}>
                <LockOutlinedIcon sx={{ fontSize: 13 }} />
                <Text variant="caption" size="xs" color="secondary" as="span">
                  Pagamento seguro
                </Text>
              </Box>
            </Box>
          </Box>
        </Box>
      </ActionBar>
    </>
  );
}

/** Props for {@link PaymentStep} — step 2's inputs, wired by the flow. */
interface PaymentStepProps {
  method: PaymentMethod | null;
  onMethodChange: (method: PaymentMethod) => void;
  order: CheckoutOrder | null;
  buyer: BuyerInfo;
  creating: boolean;
  createError: string | null;
  errorField: BuyerField | null;
  /**
   * The refusal's machine code (FUT-563). An UNRESOLVED charge is not a failed
   * one — the panel below must not offer to raise a second.
   */
  errorCode?: string | null;
  onGenerate: (method: PaymentMethod) => void;
  onUseEmail: (email: string) => void;
  /**
   * Present ⇒ the buyer reached this step without a Dados step (FUT-465), so
   * the payer block states who is being charged and reopens Dados to change it.
   */
  onEditBuyer?: () => void;
  /**
   * The store's active payment protocol (`GET /api/checkout/config`, FUT-697).
   * `null` while loading or on a transient fetch failure — methods then render
   * as before and the card path degrades to the PagBank per-order key refresh,
   * WITHOUT mock permission (fail-open for the UI, fail-closed for the money).
   */
  providerConfig?: CheckoutProviderConfig | null;
  /** Scopes the saved-card list to the store being paid (host routing owns it). */
  tenantSlug?: string;
  pollIntervalMs?: number;
  onResolved: (status: OrderStatus) => void;
}

/**
 * Step 2 "Pagamento" — pick PIX or card and pay on the SAME page. Selecting a
 * method auto-raises its order and reveals its UI (PIX QR / card form) with no
 * intermediate tap; switching method clears the previous order (controller).
 */
export function PaymentStep({
  method,
  onMethodChange,
  order,
  buyer,
  creating,
  createError,
  errorField,
  errorCode,
  onGenerate,
  onUseEmail,
  onEditBuyer,
  providerConfig,
  tenantSlug,
  pollIntervalMs,
  onResolved,
}: PaymentStepProps): JSX.Element {
  const { LoadingState } = useCheckoutComponents();
  const cardUnavailable = !cardPathAvailable(providerConfig ?? null);
  useAutoRaiseOrder(order, method, creating, createError, onGenerate);
  usePreselectSoleMethod(cardUnavailable, method, onMethodChange);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {/* Self-hiding: renders only for a flow whose Dados step was skipped. */}
      <PayerSummary name={buyer.name} taxId={buyer.taxId} onEdit={onEditBuyer} />

      <MethodPicker
        value={method}
        onChange={onMethodChange}
        cardUnavailable={cardUnavailable}
        offered={offeredMethods(providerConfig ?? null)}
      />

      <PaymentBody
        order={order}
        buyer={buyer}
        providerConfig={providerConfig ?? null}
        tenantSlug={tenantSlug}
        onResolved={onResolved}
        pollIntervalMs={pollIntervalMs}
      />

      {!order && creating ? (
        <LoadingState variant="spinner" size="md" message="Gerando pagamento…" dataTestId="payment-generating" />
      ) : null}

      {!order && method && createError ? (
        <PaymentErrorPanel
          message={createError}
          emailFlagged={errorField === "email"}
          code={errorCode}
          onUseEmail={onUseEmail}
          onRetry={() => onGenerate(method)}
        />
      ) : null}
    </Box>
  );
}
