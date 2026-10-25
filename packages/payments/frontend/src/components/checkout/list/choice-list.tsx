import { Box } from "@mui/material";
import { useId, useRef, type JSX, type ReactNode } from "react";

import { useCheckoutCopy } from "../copy-context";
import type { BuyerInfo } from "../types";

import { cardName, type OnlineRow } from "./choice";
import type { ListChargeFailure } from "./charge-runners";
import { OnlineContent, opensContent } from "./online-content";
import { GroupHeading, OptionRow } from "./option-row";
import type { CheckoutDoorOption, CheckoutOnlineChoice, PaymentListCopy } from "./types";
import type { ListState } from "./use-list-state";

/** An online row's label and hint, worded for what the store and the buyer hold. */
function onlineWords(
  row: OnlineRow,
  copy: PaymentListCopy,
  state: ListState,
  provider: string | null,
): { label: string; hint: string } {
  const { method } = row;
  // A debit row exists only with these words (`useDebitReady`).
  if (row.funding === "DEBIT" && copy.debit) return { label: copy.debit.label, hint: copy.debit.hint };
  if (method === "PIX") return copy.pix;
  if (method === "GOOGLE_PAY") return copy.googlePay;
  if (method === "HAND_OFF") return { label: copy.handOff.label, hint: copy.handOff.hint(provider) };
  const head = state.card.saved[0];
  return {
    label: copy.card.label,
    hint: head ? copy.card.hintSaved(cardName(copy, head)) : copy.card.hintNew,
  };
}

/** A row's identity — its method, and `-DEBIT` for the debit card (FUT-3754). */
function rowKey(row: OnlineRow): string {
  return row.funding ? `${row.method}-${row.funding}` : row.method;
}

/** The hint of a card the store declares and this browser cannot take — today's words (N9). */
function useUnavailableHint(): string {
  return useCheckoutCopy().screens.method.unavailableHere;
}

/**
 * Put the buyer in the CPF at the top of Pagamento (FUT-3995): its field takes
 * the focus — in the tap's own handler, so a phone opens its keyboard — and
 * the block, words included, is scrolled into view only when it is not already.
 */
function focusTopCpf(list: HTMLElement | null): void {
  const block = list?.querySelector<HTMLElement>('[data-testid="list-cpf"]');
  const input = block?.querySelector<HTMLInputElement>("input");
  if (!block || !input) return;
  input.focus({ preventScroll: true });
  // Absent where there is no layout (jsdom, a host's own tests): the focus alone.
  if (typeof block.scrollIntoView === "function") block.scrollIntoView({ block: "nearest" });
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
  /** The host's balance pays the whole amount: the card asks for no card at all. */
  covered?: boolean;
  /** Whether choosing this online option leaves the CPF at the top to type (FUT-3995). */
  cpfAsked?: (choice: CheckoutOnlineChoice) => boolean;
  /** The buyer chose an online row themselves — the list may take them to the CPF. */
  onChosenOnline: (choice: CheckoutOnlineChoice) => void;
}

/** One of the store's online options, with what opens inside it. */
function OnlineOptionRow({ row, props }: { row: OnlineRow; props: RowProps }): JSX.Element {
  const { copy, state, provider } = props;
  const unavailable = useUnavailableHint();
  const words = onlineWords(row, copy, state, provider);
  const chosen = state.choice?.kind === "online" && state.choice.method === row.method && state.choice.funding === row.funding;
  return (
    <OptionRow
      name={props.name}
      value={rowKey(row)}
      chosen={chosen}
      disabled={row.disabled}
      label={words.label}
      hint={row.disabled ? unavailable : words.hint}
      onChoose={() => {
        state.choose({ kind: "online", method: row.method, ...(row.funding ? { funding: row.funding } : {}) });
        // Only the buyer's own choice: a preselection never comes through here.
        props.onChosenOnline(row.method);
      }}
      testId={`list-option-${rowKey(row)}`}
    >
      {opensContent(row.method, state.asked, props.failure, props.covered) ? (
        <OnlineContent
        withConsent={!state.top}
        method={row.method}
        debit={row.funding === "DEBIT"}
        asked={state.asked}
        buyer={props.buyer}
        onBuyerChange={props.onBuyerChange}
        card={state.card}
        copy={copy}
        provider={provider}
        failure={props.failure}
        covered={props.covered}
        />
      ) : null}
    </OptionRow>
  );
}

/** One of the host's door options: its words, and its content opened inside it. */
function DoorOptionRow({ option, props }: { option: CheckoutDoorOption; props: RowProps }): JSX.Element {
  const { choice } = props.state;
  const chosen = choice?.kind === "door" && choice.id === option.id;
  const choose = (): void => {
    if (!chosen) props.state.choose({ kind: "door", id: option.id });
  };
  // A function content gets the row's own controls (FUT-3715): a chip inside
  // it can choose the row in the tap that answers it.
  const content = typeof option.content === "function" ? option.content({ chosen, choose }) : option.content;
  return (
    <OptionRow
      name={props.name}
      value={`door:${option.id}`}
      chosen={chosen}
      label={option.label}
      hint={chosen && option.hideHintWhileChosen ? undefined : option.hint}
      onChoose={choose}
      testId={`list-door-${option.id}`}
      open={option.showContentWhileIdle === true}
    >
      {content}
    </OptionRow>
  );
}

/** Read by a screen reader, not drawn. */
const VISUALLY_HIDDEN = { position: "absolute", width: "1px", height: "1px", m: 0, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" } as const;

/** One heading and the rows under it, as a group named by the heading. */
function Group({ id, heading, children }: { id: string; heading: string; children: ReactNode }): JSX.Element {
  return (
    <Box role="group" aria-labelledby={id} sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
      <GroupHeading id={id}>{heading}</GroupHeading>
      {children}
    </Box>
  );
}

/**
 * "Como você quer pagar?" — every way to pay as ONE radio group under two
 * headings (FUT-3591, M6): the store's online options, then the host's door
 * options. Choosing a row only chooses it; the bar's button acts. Above them,
 * `top`: the CPF and the wallet block (FUT-3685), which are not part of the
 * group (R1).
 *
 * One radio `name` across both groups keeps them one choice for the keyboard;
 * each heading names its own `role="group"`, and what opens inside a row sits
 * beside its radio's label, never inside it.
 */
export function ChoiceList({
  door,
  locked,
  top,
  ...rest
}: Omit<RowProps, "name" | "onChosenOnline"> & {
  door: readonly CheckoutDoorOption[];
  /** A charge or a send is under way: the list is inert. */
  locked: boolean;
  /** The CPF and the wallets, above the rows (FUT-3685) — inert with them. */
  top?: ReactNode;
}): JSX.Element {
  const base = useId();
  const listRef = useRef<HTMLDivElement | null>(null);
  // The last thing the buyer did in the list was a key: the arrows walking the
  // radio group (or Space) keep the focus in it. A pointer — a tap, a click —
  // clears it. (A tap on a row's words reaches the radio as a click with no
  // click count, so the event itself cannot tell a tap from the arrows.)
  const keyed = useRef(false);
  const onChosenOnline = (choice: CheckoutOnlineChoice): void => {
    if (!keyed.current && rest.cpfAsked?.(choice)) focusTopCpf(listRef.current);
  };
  const props: RowProps = { ...rest, name: `${base}-choice`, onChosenOnline };
  const { copy, state } = props;
  // Nothing to tap before the saved cards answer: a row tapped now would move
  // when the saved card is preselected and opens its chips (FUT-3849).
  if (!state.settled) return <Box data-testid="payment-list-loading" aria-busy="true" sx={{ minHeight: (theme) => theme.spacing(30) }} />;
  return (
    <Box
      ref={listRef}
      onKeyDownCapture={() => {
        keyed.current = true;
      }}
      onPointerDownCapture={() => {
        keyed.current = false;
      }}
      data-testid="payment-list"
      data-locked={locked ? "true" : "false"}
      aria-disabled={locked || undefined}
      inert={locked || undefined}
      aria-labelledby={`${base}-title`}
      sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}
    >
      {/* The list's name, for a screen reader: the step's own heading is what a
          sighted buyer reads (the host's "Pagamento" card, T1). */}
      <Box component="p" id={`${base}-title`} sx={VISUALLY_HIDDEN}>
        {copy.title}
      </Box>
      {top}
      {/* Each heading only over a group that has rows (a door-only store shows the door one alone). */}
      {state.rows.length > 0 ? (
        <Group id={`${base}-online`} heading={copy.onlineHeading}>
          {state.rows.map((row) => <OnlineOptionRow key={rowKey(row)} row={row} props={props} />)}
        </Group>
      ) : null}
      {door.length > 0 ? (
        <Group id={`${base}-door`} heading={copy.doorHeading}>
          {door.map((option) => <DoorOptionRow key={option.id} option={option} props={props} />)}
        </Group>
      ) : null}
    </Box>
  );
}
