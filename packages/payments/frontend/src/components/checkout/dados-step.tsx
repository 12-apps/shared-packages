import { Box } from "@mui/material";
import type { JSX, ReactNode } from "react";

import { BuyerInfoForm } from "./buyer-info-form";
import { LockOutlinedIcon } from "./icons";
import { displayTotals, PayBarTotal } from "./checkout-totals";
import type { BuyerField, BuyerInfo, CheckoutCustomerField } from "./types";
import { useCheckoutComponents } from "./ui";
import type { DadosStepCopy } from "./view-copy";

/**
 * Step 1 of the buyer checkout, and its sticky bar.
 *
 * Split out of `./checkout-steps.tsx` when the Pagamento step grew a money line
 * of its own (FUT-1179) and took that file past its size gate. The seam is the
 * one the flow already renders on: one step per module, with the totals both of
 * them show living in `./checkout-totals.tsx`.
 */

/**
 * Step 1 "Dados" — the buyer's register info (CPF plus optional name/email/
 * phone; contact pre-filled from the saved buyer profile). NO payment method
 * here (that's step 2); nav lives in the slim checkout header. "Continuar"
 * (sticky, with the live total) validates the CPF and advances to "Pagamento"
 * — no charge yet.
 */
export function DadosStep({
  copy,
  buyer,
  onBuyerChange,
  saveProfile,
  onSaveProfileChange,
  createError,
  errorField,
  onContinue,
  cartTotals,
  buyerFields,
  discountLines,
  totalOverride,
}: {
  /** The step's own sentences — the HOST's words (see `./view-copy`). */
  copy: DadosStepCopy;
  buyer: BuyerInfo;
  onBuyerChange: (buyer: BuyerInfo) => void;
  saveProfile: boolean;
  onSaveProfileChange: (value: boolean) => void;
  createError: string | null;
  errorField: BuyerField | null;
  onContinue: () => void;
  /** The host cart's own totals — what the pay bar shows in cart mode. */
  cartTotals: { totalLabel: string; totalItems: number };
  /** What the store's chain declares it needs (FUT-595); absent ⇒ CPF-required. */
  buyerFields?: readonly CheckoutCustomerField[];
  /**
   * The saving, itemized under the total the buyer is about to authorize
   * (FUT-246) — RENDERED BY THE HOST from its cart (the storefront passes its
   * cart footer's money block), never re-implemented here, so the two surfaces
   * can never word the same discount differently.
 */
  discountLines?: ReactNode;
  /** Settling an open balance: totals come from the settlement, not the cart. */
  totalOverride?: { label: string; items: number };
}): JSX.Element {
  const { Checkbox } = useCheckoutComponents();
  const { label: totalLabel, items: totalItems } = displayTotals(totalOverride, cartTotals);

  return (
    <>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 3, pb: { xs: createError ? 22 : 14, sm: createError ? 20 : 12 } }}>
        <BuyerInfoForm
          value={buyer}
          onChange={onBuyerChange}
          fields={buyerFields}
          fieldError={errorField && createError ? { field: errorField, message: createError } : null}
        />
        <Checkbox
          checked={saveProfile}
          onChange={(_event, checked) => onSaveProfileChange(checked)}
          label={copy.saveProfile}
          data-testid="buyer-save-profile"
        />
      </Box>

      <DadosPayBar
        copy={copy}
        totalLabel={totalLabel}
        totalItems={totalItems}
        createError={createError}
        onContinue={onContinue}
      >
        {/* Suppressed while settling a balance: those totals come from the
            frozen ticket, not the cart. */}
        {totalOverride ? null : discountLines}
      </DadosPayBar>
    </>
  );
}

/** The sticky "Continuar" bar: the refusal, the money, and the one action. */
function DadosPayBar({
  copy,
  totalLabel,
  totalItems,
  createError,
  onContinue,
  children,
}: {
  copy: DadosStepCopy;
  totalLabel: string;
  totalItems: number;
  createError: string | null;
  onContinue: () => void;
  children?: ReactNode;
}): JSX.Element {
  const { ActionBar, Alert, Button, Text } = useCheckoutComponents();
  return (
    <ActionBar dataTestId="checkout-pay-bar">
      <Box sx={{ width: "100%", display: "flex", flexDirection: "column", gap: 1.5 }}>
        {createError ? (
          <Alert variant="danger" title={copy.cannotContinueTitle} description={createError} showIcon data-testid="checkout-error" />
        ) : null}
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <PayBarTotal totalLabel={totalLabel} totalItems={totalItems}>{children}</PayBarTotal>
          <Box sx={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 0.5, minWidth: 0 }}>
            <Button variant="solid" color="primary" size="lg" fullWidth onClick={onContinue} dataTestId="checkout-continue">
              {copy.continueAction}
            </Button>
            {copy.secureNotice ? (
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, color: "text.secondary" }}>
                <LockOutlinedIcon sx={{ fontSize: 13 }} />
                <Text variant="caption" size="xs" color="secondary" as="span">
                  {copy.secureNotice}
                </Text>
              </Box>
            ) : null}
          </Box>
        </Box>
      </Box>
    </ActionBar>
  );
}
