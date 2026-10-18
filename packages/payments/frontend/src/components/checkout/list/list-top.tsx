import { Box } from "@mui/material";
import { Suspense, type JSX } from "react";

import type { BuyerInfo, CheckoutCustomerField, CheckoutProviderConfig, PaymentMethod } from "../types";

import type { ListChargeFailure } from "./charge-runners";
import { deferredPart } from "./lazy-body";
import { cpfHolds } from "./top-cpf";
import type { CheckoutPaymentList } from "./types";
import type { ListCapability } from "./use-capability";
import type { ListState } from "./use-list-state";

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

/** What the top of the list reads, gathered by the face. */
export interface ListTopFacts {
  list: CheckoutPaymentList;
  state: ListState;
  cap: ListCapability;
  config: CheckoutProviderConfig | null;
  c: { buyer: BuyerInfo; setBuyer: (buyer: BuyerInfo) => void };
  revealed: boolean;
  /** Close a CPF opened over the one on file, keeping that one. */
  onKeepSavedCpf: () => void;
}

/** What the top of the list is handed by the face. */
export interface ListTopInput {
  props: ListTopFacts;
  held: string | null;
  /** The last wallet charge's refusal, said under the buttons. */
  failure: ListChargeFailure | null;
  onGoogle: () => void;
  onApple: () => void;
}

const useListTopBody = deferredPart(async () => ({ default: (await import("./list-top-body")).ListTopBody }));

/**
 * The top of Pagamento (FUT-3685): the CPF, asked once (E1, L7), then the
 * "PAGAMENTO RÁPIDO" block (C5, C6) — both above the rows.
 *
 * Only the decision to draw it is here; what it draws is a chunk of its own
 * (FUT-3711), so a checkout with neither a CPF to ask nor a wallet ready never
 * parses it. Nothing is drawn while that chunk loads — only an undrawn
 * `list-top-loading` marker, so a test can wait for the top to land before
 * asking what it shows (`display: none` takes no row and no gap). What the CPF holds — the
 * pay button, the wallets — is decided in this file (`gateFields`,
 * `walletsHeld`), so the hold is in force before the field is on screen.
 */
export function ListTop(input: ListTopInput): JSX.Element | null {
  const { state, cap } = input.props;
  if (!state.top && cap.wallets.length === 0) return null;
  return <DeferredTop {...input} />;
}

/** The top's chunk, asked of the host's loader only once there is a top to draw. */
function DeferredTop(input: ListTopInput): JSX.Element {
  const Body = useListTopBody();
  return (
    <Suspense fallback={<Box data-testid="list-top-loading" sx={{ display: "none" }} />}>
      <Body {...input} />
    </Suspense>
  );
}
