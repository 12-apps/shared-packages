/**
 * The factory's vault screens (FUT-183), the buyer half of FUT-478: adding a
 * card OUTSIDE a purchase, and seeing the cards already on file.
 *
 * Same shape as every other factory screen: thin bindings over the shared
 * card primitives, rendered through the `CheckoutComponents` slots, wrapped in
 * `FlowsShell` so each one works standalone. The state machine lives in
 * `use-add-card.ts`; the views here take its controller, which is also what
 * lets a story stage any phase as a literal without touching a network.
 *
 * There is deliberately NO delete affordance on the manage screen: PagBank
 * publishes no endpoint that deletes a stored card token, so a buyer-facing
 * "remover cartão" could only fake the removal at the provider that most needs
 * it. Taking a card off file stays a merchant/host concern, on the admin
 * surface's named-provider `vault/:provider/forget` row (see the backend's
 * `checkout/flows-vault.ts`) — which is also why S2 exposes no buyer forget
 * for this screen to call.
 */
import { Box } from "@mui/material";
import { useEffect, useState, type JSX } from "react";

import { NewCardForm, type SavedCard } from "../card";
import type { VaultedCardDisplay } from "../components/checkout/transport";
import { useCheckoutComponents } from "../components/checkout/ui";

import type { CheckoutCopyFE } from "./copy";
import { FlowsShell, type FlowsRuntime } from "./runtime";
import type { CheckoutScreens } from "./types";
import { useAddCard, type AddCardController } from "./use-add-card";

/** `visa •••• 4242`, or just the brand when the provider shared no last4. */
function displayLabel(display: VaultedCardDisplay): string {
  const brand = display.brand ?? "Cartão";
  return display.last4 ? `${brand} •••• ${display.last4}` : brand;
}

/** `Validade 12/2031`, or nothing when the provider shared no expiry. */
function expiryLabel(display: VaultedCardDisplay): string | null {
  if (display.expMonth === null || display.expYear === null) return null;
  return `Validade ${String(display.expMonth).padStart(2, "0")}/${display.expYear}`;
}

/** The card is on file — display metadata only, never the vault token. */
function SavedConfirmation({
  display,
  copy,
}: {
  display: VaultedCardDisplay;
  copy: CheckoutCopyFE;
}): JSX.Element {
  const { Alert, Text } = useCheckoutComponents();
  const expiry = expiryLabel(display);
  return (
    <Box data-testid="add-card-saved" sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Alert
        variant="info"
        title={copy.addCardSavedTitle}
        description={copy.addCardSavedBody}
        showIcon
      />
      <Box>
        <Text variant="body" size="sm" weight="semibold" as="p">
          {displayLabel(display)}
        </Text>
        {expiry ? (
          <Text variant="caption" size="xs" color="secondary" as="p">
            {expiry}
          </Text>
        ) : null}
      </Box>
    </Box>
  );
}

/** The form phase: the shared card fields, the refusal, the save action. */
function AddCardForm({
  controller,
  copy,
}: {
  controller: AddCardController;
  copy: CheckoutCopyFE;
}): JSX.Element {
  const { Alert, Button, Text } = useCheckoutComponents();
  return (
    <Box data-testid="add-card" sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Text variant="heading" size="md" weight="bold" as="h2">
        {copy.addCardTitle}
      </Text>
      {/* No save-card opt-in: this screen IS the opt-in, so a checkbox here
          would be a second question about the same consent. */}
      <NewCardForm
        card={controller.card}
        fieldErrors={controller.fieldErrors}
        brand={controller.brand}
        setCard={controller.setCard}
        setFieldErrors={controller.setFieldErrors}
      />
      {controller.error ? (
        <Alert
          variant="danger"
          title={copy.addCardFailedTitle}
          description={controller.error}
          showIcon
          data-testid="add-card-error"
        />
      ) : null}
      <Button
        variant="solid"
        color="primary"
        size="lg"
        fullWidth
        loading={controller.saving}
        disabled={controller.saving}
        onClick={() => void controller.submit()}
        dataTestId="add-card-save"
      >
        {copy.addCardAction}
      </Button>
    </Box>
  );
}

/** The add-card screen body, one branch per {@link AddCardController} phase. */
export function AddCardView({
  controller,
  copy,
}: {
  controller: AddCardController;
  copy: CheckoutCopyFE;
}): JSX.Element {
  const { Alert, LoadingState } = useCheckoutComponents();
  const { phase } = controller;
  if (phase.kind === "preparing") {
    return (
      <LoadingState
        variant="spinner"
        size="md"
        message={copy.addCardPreparing}
        dataTestId="add-card-preparing"
      />
    );
  }
  if (phase.kind === "unavailable") {
    return (
      <Alert
        variant="info"
        title={copy.addCardTitle}
        description={phase.message}
        showIcon
        data-testid="add-card-unavailable"
      />
    );
  }
  if (phase.kind === "saved") {
    return <SavedConfirmation display={phase.display} copy={copy} />;
  }
  return <AddCardForm controller={controller} copy={copy} />;
}

/** The live add-card flow — the hook and the view, bound to one runtime. */
function AddCardSection({
  runtime,
  onSaved,
}: {
  runtime: FlowsRuntime;
  onSaved?: (display: VaultedCardDisplay) => void;
}): JSX.Element {
  const controller = useAddCard(runtime, onSaved);
  return <AddCardView controller={controller} copy={runtime.copy} />;
}

/**
 * The caller's instruments at this store (FUT-697 scoping), with a pending
 * flag so the empty-state sentence never flashes while the list is in flight.
 */
function useInstrumentList(
  runtime: FlowsRuntime,
  refresh: number,
): { cards: SavedCard[]; pending: boolean } {
  const tenantSlug = runtime.useTenantSlug();
  const [state, setState] = useState<{ cards: SavedCard[]; pending: boolean }>({
    cards: [],
    pending: true,
  });
  useEffect(() => {
    let active = true;
    void runtime.client.listInstruments(tenantSlug).then((cards) => {
      if (active) setState({ cards, pending: false });
    });
    return () => {
      active = false;
    };
  }, [runtime, tenantSlug, refresh]);
  return state;
}

/** The list itself, or the empty-state sentence. Read-only by design. */
function CardList({ cards, emptyCopy }: { cards: SavedCard[]; emptyCopy: string }): JSX.Element {
  const { Text } = useCheckoutComponents();
  if (cards.length === 0) {
    return (
      <Text variant="body" size="sm" color="secondary" as="p" data-testid="manage-cards-empty">
        {emptyCopy}
      </Text>
    );
  }
  return (
    <Box data-testid="manage-cards-list" sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      {cards.map((card) => (
        <Box key={card.id} data-testid={`manage-cards-item-${card.id}`}>
          <Text variant="body" size="sm" weight="semibold" as="p">
            {`${card.brand} •••• ${card.last4}`}
          </Text>
          {card.expMonth && card.expYear ? (
            <Text variant="caption" size="xs" color="secondary" as="p">
              {`Validade ${String(card.expMonth).padStart(2, "0")}/${card.expYear}`}
            </Text>
          ) : null}
        </Box>
      ))}
    </Box>
  );
}

/** The manage screen: the list, and the door into the add flow. */
function ManageCardsBody({ runtime }: { runtime: FlowsRuntime }): JSX.Element {
  const { Button, Text } = useCheckoutComponents();
  const copy = runtime.copy;
  const [adding, setAdding] = useState(false);
  // Bumped when the add flow saves, so the list re-reads what is now on file.
  const [refresh, setRefresh] = useState(0);
  const { cards, pending } = useInstrumentList(runtime, refresh);
  return (
    <Box data-testid="manage-cards" sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Text variant="heading" size="md" weight="bold" as="h2">
        {copy.manageCardsTitle}
      </Text>
      {pending ? null : <CardList cards={cards} emptyCopy={copy.manageCardsEmpty} />}
      {adding ? (
        <AddCardSection runtime={runtime} onSaved={() => setRefresh((count) => count + 1)} />
      ) : (
        <Button
          variant="outline"
          color="primary"
          size="lg"
          fullWidth
          onClick={() => setAdding(true)}
          dataTestId="manage-cards-add"
        >
          {copy.manageCardsAdd}
        </Button>
      )}
    </Box>
  );
}

function buildAddCard(runtime: FlowsRuntime): CheckoutScreens["AddCard"] {
  return function AddCard({ onSaved }) {
    return (
      <FlowsShell runtime={runtime}>
        <AddCardSection runtime={runtime} onSaved={onSaved} />
      </FlowsShell>
    );
  };
}

function buildManageCards(runtime: FlowsRuntime): CheckoutScreens["ManageCards"] {
  return function ManageCards() {
    return (
      <FlowsShell runtime={runtime}>
        <ManageCardsBody runtime={runtime} />
      </FlowsShell>
    );
  };
}

export const vaultScreens = {
  buildAddCard,
  buildManageCards,
};
