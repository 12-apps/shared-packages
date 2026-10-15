import { Box } from "@mui/material";
import { useId, type JSX } from "react";

import { useCheckoutCopy } from "../copy-context";
import type { BuyerInfo } from "../types";
import { useCheckoutComponents } from "../ui";

import type { OnlineRow } from "./choice";
import type { ListChargeFailure } from "./charge-runners";
import { OnlineContent } from "./online-content";
import { GroupHeading, OptionRow } from "./option-row";
import type { CheckoutDoorOption, CheckoutOnlineChoice, PaymentListCopy } from "./types";
import type { ListState } from "./use-list-state";

/** An online row's label and hint, worded for what the store and the buyer hold. */
function onlineWords(
  method: CheckoutOnlineChoice,
  copy: PaymentListCopy,
  state: ListState,
  provider: string | null,
): { label: string; hint: string } {
  if (method === "PIX") return copy.pix;
  if (method === "GOOGLE_PAY") return copy.googlePay;
  if (method === "HAND_OFF") return { label: copy.handOff.label, hint: copy.handOff.hint(provider) };
  const head = state.card.saved[0];
  return {
    label: copy.card.label,
    hint: head ? copy.card.hintSaved(copy.savedCard(head.brand, head.last4)) : copy.card.hintNew,
  };
}

/** The hint of a card the store declares and this browser cannot take — today's words (N9). */
function useUnavailableHint(): string {
  return useCheckoutCopy().screens.method.unavailableHere;
}

/** What every row of the list is drawn from. */
interface RowProps {
  name: string;
  copy: PaymentListCopy;
  state: ListState;
  buyer: BuyerInfo;
  onBuyerChange: (buyer: BuyerInfo) => void;
  provider: string | null;
  failure: ListChargeFailure | null;
}

/** One of the store's online options, with what opens inside it. */
function OnlineOptionRow({ row, props }: { row: OnlineRow; props: RowProps }): JSX.Element {
  const { copy, state, provider } = props;
  const unavailable = useUnavailableHint();
  const words = onlineWords(row.method, copy, state, provider);
  const chosen = state.choice?.kind === "online" && state.choice.method === row.method;
  return (
    <OptionRow
      name={props.name}
      value={row.method}
      chosen={chosen}
      disabled={row.disabled}
      label={words.label}
      hint={row.disabled ? unavailable : words.hint}
      onChoose={() => state.choose({ kind: "online", method: row.method })}
      testId={`list-option-${row.method}`}
    >
      <OnlineContent
        method={row.method}
        asked={state.asked}
        buyer={props.buyer}
        onBuyerChange={props.onBuyerChange}
        card={state.card}
        copy={copy}
        provider={provider}
        failure={props.failure}
      />
    </OptionRow>
  );
}

/** One of the host's door options: its words, and its content opened inside it. */
function DoorOptionRow({ option, props }: { option: CheckoutDoorOption; props: RowProps }): JSX.Element {
  const { choice } = props.state;
  const chosen = choice?.kind === "door" && choice.id === option.id;
  return (
    <OptionRow
      name={props.name}
      value={`door:${option.id}`}
      chosen={chosen}
      label={option.label}
      hint={chosen && option.hideHintWhileChosen ? undefined : option.hint}
      onChoose={() => props.state.choose({ kind: "door", id: option.id })}
      testId={`list-door-${option.id}`}
    >
      {option.content}
    </OptionRow>
  );
}

/**
 * "Como você quer pagar?" — every way to pay as ONE radio group under two
 * headings (FUT-3591, M6): the store's online options, then the host's door
 * options. Choosing a row only chooses it; the bar's button acts.
 */
export function ChoiceList({
  door,
  locked,
  ...rest
}: Omit<RowProps, "name"> & {
  door: readonly CheckoutDoorOption[];
  /** The card's 5-second bar is running: the list is inert, only Cancelar acts. */
  locked: boolean;
}): JSX.Element {
  const { Text } = useCheckoutComponents();
  const props: RowProps = { ...rest, name: useId() };
  const { copy, state } = props;
  return (
    <Box
      data-testid="payment-list"
      data-locked={locked ? "true" : "false"}
      role="radiogroup"
      aria-label={copy.title}
      aria-disabled={locked || undefined}
      inert={locked || undefined}
      sx={{ display: "flex", flexDirection: "column", gap: 1.5, opacity: locked ? 0.6 : 1 }}
    >
      <Text variant="body" size="md" weight="bold" as="p" style={{ margin: 0 }}>
        {copy.title}
      </Text>
      {/* Each heading only over a group that has rows (a door-only store shows the door one alone). */}
      {state.rows.length > 0 ? <GroupHeading>{copy.onlineHeading}</GroupHeading> : null}
      {state.rows.map((row) => <OnlineOptionRow key={row.method} row={row} props={props} />)}
      {door.length > 0 ? (
        <Box sx={{ mt: state.rows.length > 0 ? 0.75 : 0 }}>
          <GroupHeading>{copy.doorHeading}</GroupHeading>
        </Box>
      ) : null}
      {door.map((option) => <DoorOptionRow key={option.id} option={option} props={props} />)}
    </Box>
  );
}
