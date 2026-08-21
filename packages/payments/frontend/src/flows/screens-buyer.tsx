/**
 * The buyer-facing screens the factory binds (FUT-741), part one: choosing a
 * method, stating who is paying, reusing a card, and the empty cart.
 *
 * Every one of them is a THIN binding. The behaviour still lives in the
 * components this package already shipped; what is new is that the config,
 * the transport, the scope and the slots arrive from the factory instead of
 * from six props the host had to thread itself.
 */
import { Box } from "@mui/material";
import { useEffect, useMemo, useState, type JSX } from "react";

import { SavedCardsPicker, type SavedCard } from "../card";
import { buyerFieldsFor } from "../components/checkout/buyer-fields";
import { BuyerInfoForm } from "../components/checkout/buyer-info-form";
import { EmptyCart as EmptyCartView } from "../components/checkout/checkout-steps";
import {
  cardPathAvailable,
  offeredMethods,
  selectableMethods,
  usePreselectSoleMethod,
} from "../components/checkout/method-capability";
import { MethodPicker } from "../components/checkout/method-picker";
import { PayerSummary as PayerSummaryView } from "../components/checkout/payer-summary";
import type { BuyerInfo, PaymentMethod } from "../components/checkout/types";
import { useCheckoutComponents } from "../components/checkout/ui";

import { FlowsShell, useResolvedConfig, type FlowsRuntime } from "./runtime";
import type { BuyerDetailsProps, CheckoutScreens } from "./types";

function buildMethodChoice(runtime: FlowsRuntime): CheckoutScreens["MethodChoice"] {
  function MethodChoiceBody({
    value,
    onChange,
  }: {
    value: PaymentMethod | null;
    onChange: (method: PaymentMethod) => void;
  }): JSX.Element {
    const { config } = useResolvedConfig(runtime);
    const offered = offeredMethods(config);
    const cardUnavailable = !cardPathAvailable(config);
    usePreselectSoleMethod(selectableMethods(offered, cardUnavailable), value, onChange);
    return (
      <MethodPicker
        value={value}
        onChange={onChange}
        cardUnavailable={cardUnavailable}
        offered={offered}
      />
    );
  }
  return function MethodChoice(props) {
    return (
      <FlowsShell runtime={runtime}>
        <MethodChoiceBody {...props} />
      </FlowsShell>
    );
  };
}

function buildBuyerDetails(runtime: FlowsRuntime): CheckoutScreens["BuyerDetails"] {
  function BuyerDetailsBody({
    value,
    onChange,
    method,
    onContinue,
    error,
  }: BuyerDetailsProps): JSX.Element {
    const { Button, Text } = useCheckoutComponents();
    const { config } = useResolvedConfig(runtime);
    // ∩ method (FUT-595). An absent declaration degrades to CPF-required —
    // never to "ask nothing", which is a 400 the buyer only meets after
    // finishing the form.
    const fields = useMemo(() => buyerFieldsFor(config?.chain, method), [config, method]);
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <BuyerInfoForm value={value} onChange={onChange} fields={fields} fieldError={error} />
        <Box>
          <Button
            variant="solid"
            color="primary"
            size="lg"
            fullWidth
            onClick={onContinue}
            dataTestId="checkout-continue"
          >
            {runtime.copy.continueAction}
          </Button>
        </Box>
        {runtime.copy.secureNotice ? (
          <Text variant="caption" size="xs" color="secondary" as="p">
            {runtime.copy.secureNotice}
          </Text>
        ) : null}
      </Box>
    );
  }
  return function BuyerDetails(props) {
    return (
      <FlowsShell runtime={runtime}>
        <BuyerDetailsBody {...props} />
      </FlowsShell>
    );
  };
}

function buildPayerSummary(runtime: FlowsRuntime): CheckoutScreens["PayerSummary"] {
  return function PayerSummary({ buyer, onEdit }: { buyer: BuyerInfo; onEdit?: () => void }) {
    return (
      <FlowsShell runtime={runtime}>
        <PayerSummaryView name={buyer.name} taxId={buyer.taxId} onEdit={onEdit} />
      </FlowsShell>
    );
  };
}

/** The vaulted instruments this store can actually charge (FUT-697 scoping). */
function useScopedInstruments(runtime: FlowsRuntime): SavedCard[] {
  const tenantSlug = runtime.useTenantSlug();
  const [cards, setCards] = useState<SavedCard[]>([]);
  useEffect(() => {
    let active = true;
    void runtime.client.listInstruments(tenantSlug).then((list) => {
      if (active) setCards(list);
    });
    return () => {
      active = false;
    };
  }, [runtime, tenantSlug]);
  return cards;
}

function buildSavedCards(runtime: FlowsRuntime): CheckoutScreens["SavedCards"] {
  function SavedCardsBody({
    selection,
    onSelect,
  }: {
    selection: string;
    onSelect: (id: string) => void;
  }): JSX.Element | null {
    const savedCards = useScopedInstruments(runtime);
    // Nothing to reuse renders nothing at all — an empty picker is a heading
    // over a void, and the new-card form below it already says what to do.
    if (savedCards.length === 0) return null;
    return <SavedCardsPicker savedCards={savedCards} selection={selection} onSelect={onSelect} />;
  }
  return function SavedCards(props) {
    return (
      <FlowsShell runtime={runtime}>
        <SavedCardsBody {...props} />
      </FlowsShell>
    );
  };
}

function buildEmptyCart(runtime: FlowsRuntime): CheckoutScreens["EmptyCart"] {
  return function EmptyCart() {
    return (
      <FlowsShell runtime={runtime}>
        <EmptyCartView onBack={runtime.config.ports.exitToCatalog} />
      </FlowsShell>
    );
  };
}

export const buyerScreens = {
  buildMethodChoice,
  buildBuyerDetails,
  buildPayerSummary,
  buildSavedCards,
  buildEmptyCart,
};
