import { createContext, useContext, useMemo, useRef, useState, type JSX, type MutableRefObject, type ReactNode } from "react";

import type { DeferredCopy } from "../pix-parts";

import type { CheckoutPaymentList, PixBankId } from "./types";

/**
 * What the bar's Pix press asked of the code it is raising (FUT-3612): copy it
 * the moment it arrives (the clipboard was opened inside the tap), then open
 * `bank` — or show the six banks when `pick`. Consumed once by the Pix face.
 */
export interface PixIntent {
  copy: DeferredCopy;
  bank: PixBankId | null;
  pick: boolean;
}

/**
 * What the one list shares with the panes it mounts (FUT-3591/3592): its
 * config — the words and the host's bar line — and the one piece of UI state a
 * pane and the list both touch, whether the Pix QR is open on a phone.
 *
 * `null` outside list mode, which is how a pane composed for the tabs layout
 * (or by hand) knows to keep the face it always had.
 */
export interface PaymentListMode {
  list: CheckoutPaymentList;
  /** The QR is open on a narrow screen ("Ver QR code (pagar de outro celular)"). */
  qrOpen: boolean;
  setQrOpen: (open: boolean) => void;
  /** "Trocar a forma de pagamento": leave the raised Pix for the list. */
  onLeavePix: () => void;
  /**
   * The Dados step's "Salvar meus dados para a próxima compra" (LGPD), offered
   * wherever the list asks the buyer's details instead — same words, same
   * default — because the list skips that step.
   */
  consent: ListConsent;
  /** The Pix press's intent, waiting for its code — see {@link PixIntent}. */
  pixIntent: MutableRefObject<PixIntent | null>;
}

export interface ListConsent {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

const PaymentListContext = createContext<PaymentListMode | null>(null);

export function PaymentListProvider({
  list,
  onLeavePix,
  consent,
  children,
}: {
  list: CheckoutPaymentList;
  onLeavePix: () => void;
  consent: ListConsent;
  children: ReactNode;
}): JSX.Element {
  const [qrOpen, setQrOpen] = useState(false);
  const pixIntent = useRef<PixIntent | null>(null);
  const value = useMemo(() => ({ list, qrOpen, setQrOpen, onLeavePix, consent, pixIntent }), [list, qrOpen, onLeavePix, consent]);
  return <PaymentListContext.Provider value={value}>{children}</PaymentListContext.Provider>;
}

/** The list mode a pane is rendered in, or `null` for the tabs layout. */
export function usePaymentListMode(): PaymentListMode | null {
  return useContext(PaymentListContext);
}
