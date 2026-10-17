import { Box } from "@mui/material";
import { useRef, type JSX } from "react";

import type { BuyerInfo, CheckoutCustomerField, CheckoutProviderConfig, PaymentMethod } from "../types";

import type { ListChargeFailure } from "./charge-runners";
import { CpfTop } from "./cpf-top";
import { cpfHolds, cpfProvider } from "./top-cpf";
import type { CheckoutPaymentList } from "./types";
import type { ListCapability } from "./use-capability";
import type { ListState } from "./use-list-state";
import { WalletBlock } from "./wallet-block";

/**
 * The fields that hold the bar's button for the chosen online option, in the
 * order they are asked: the CPF at the top when this method's chain needs it
 * (or a typed one is not valid), then the row's own (E3). `method` is `null`
 * for a door choice or none — a door row never needs the CPF (R3).
 */
export function gateFields(
  state: Pick<ListState, "top" | "asked">,
  buyer: BuyerInfo,
  config: CheckoutProviderConfig | null,
  method: PaymentMethod | null,
): CheckoutCustomerField[] {
  if (method === null || !state.top) return state.asked;
  return cpfHolds(state.top, buyer, config?.chain, method) ? [state.top, ...state.asked] : state.asked;
}

/**
 * Why the wallet buttons cannot act yet, or `null`: the host's hold (a step
 * before this one is open), the CPF the provider needs (E3 — a wallet raises a
 * card order), the host re-pricing the sheet.
 */
export function walletsHeld(input: {
  state: Pick<ListState, "top">;
  buyer: BuyerInfo;
  list: CheckoutPaymentList;
  cap: ListCapability;
  config: CheckoutProviderConfig | null;
}): string | null {
  const { list, cap } = input;
  if (list.hold) return list.hold.reason;
  if (cpfHolds(input.state.top, input.buyer, input.config?.chain, "CARD")) return list.copy.reasons.cpf;
  const priced = cap.wallets.every((wallet) => (wallet === "GOOGLE_PAY" ? cap.googlePay : cap.applePay) !== null);
  return priced ? null : (list.copy.reasons.repricing ?? list.copy.reasons.choose);
}

/** Move the focus to "Número do cartão" — the next thing to type once the CPF is complete. */
function focusCardNumber(scope: HTMLElement | null): void {
  scope?.closest('[data-testid="payment-list"]')?.querySelector<HTMLInputElement>('input[data-testid="card-number"]')?.focus();
}

/** What the top of the list reads, gathered by the face. */
interface ListTopFacts {
  list: CheckoutPaymentList;
  state: ListState;
  cap: ListCapability;
  config: CheckoutProviderConfig | null;
  c: { buyer: BuyerInfo; setBuyer: (buyer: BuyerInfo) => void };
  revealed: boolean;
  /** Close a CPF opened over the one on file, keeping that one. */
  onKeepSavedCpf: () => void;
}

/**
 * The top of Pagamento (FUT-3685): the CPF, asked once (E1, L7), then the
 * "PAGAMENTO RÁPIDO" block (C5, C6) — both above the rows.
 */
export function ListTop({ props, held, failure, onGoogle, onApple }: {
  props: ListTopFacts;
  held: string | null;
  /** The last wallet charge's refusal, said under the buttons. */
  failure: ListChargeFailure | null;
  onGoogle: () => void;
  onApple: () => void;
}): JSX.Element | null {
  const scope = useRef<HTMLDivElement | null>(null);
  const { list, state, cap, config, c } = props;
  if (!state.top && cap.wallets.length === 0) return null;
  const typingCard = state.choice?.kind === "online" && state.choice.method === "CARD";
  return (
    <Box ref={scope} data-testid="list-top" sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      {state.top ? (
        <CpfTop
          field={state.top}
          buyer={c.buyer}
          onBuyerChange={c.setBuyer}
          copy={list.copy.buyer}
          provider={cpfProvider(config?.chain, state.methods)}
          onComplete={typingCard ? () => focusCardNumber(scope.current) : undefined}
          focusOnMount={props.revealed}
          onKeepSaved={props.revealed ? props.onKeepSavedCpf : undefined}
        />
      ) : null}
      <WalletBlock cap={cap} copy={list.copy} held={held} failure={failure} onGoogle={onGoogle} onApple={onApple} />
    </Box>
  );
}
