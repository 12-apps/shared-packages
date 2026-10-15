import { createContext, useContext, useMemo, useState, type JSX, type ReactNode } from "react";

import type { CheckoutPaymentList } from "./types";

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
  const value = useMemo(() => ({ list, qrOpen, setQrOpen, onLeavePix, consent }), [list, qrOpen, onLeavePix, consent]);
  return <PaymentListContext.Provider value={value}>{children}</PaymentListContext.Provider>;
}

/** The list mode a pane is rendered in, or `null` for the tabs layout. */
export function usePaymentListMode(): PaymentListMode | null {
  return useContext(PaymentListContext);
}
