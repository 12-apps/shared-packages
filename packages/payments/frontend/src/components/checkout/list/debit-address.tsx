import { Box } from "@mui/material";
import { createContext, useContext, useEffect, useMemo, useState, type JSX, type ReactNode } from "react";

import type { DebitAuthentication } from "../debit-charge";
import { useCheckoutComponents } from "../ui";

import type { CheckoutBillingAddress, CheckoutBillingLookup, PaymentListDebitCopy } from "./debit-copy";
import type { CheckoutListChoice, CheckoutPaymentList } from "./types";

/**
 * The billing address a DEBIT card's 3-D Secure sends (FUT-3754), in EVERY
 * store type (FUT-4109).
 *
 * The host's own address wins — the entrega's delivery address, or the buyer's
 * saved one. Without it the debit row asks for the CEP and the number inside
 * itself, with the street, the city and the UF from the host's CEP lookup (the
 * street is asked only when the CEP does not name one). Debit used to be drawn
 * only where the host had an address, which was the entrega alone: a mercado or
 * a balcão buyer never saw it.
 */

export interface DebitAddress {
  /** The address to authenticate with, or `null` while the buyer has not given one. */
  address: CheckoutBillingAddress | null;
  /** The debit row asks for it: the host had none, and can look a CEP up. */
  asks: boolean;
  postalCode: string;
  setPostalCode: (value: string) => void;
  number: string;
  setNumber: (value: string) => void;
  street: string;
  setStreet: (value: string) => void;
  /** What the lookup answered for the typed CEP: pending, found, or not found. */
  lookup: "idle" | "pending" | "found" | "missing";
  /** The CEP named a street, so the field is not asked. */
  streetKnown: boolean;
}

type Found = Awaited<ReturnType<CheckoutBillingLookup>>;

const DebitAddressContext = createContext<DebitAddress | null>(null);

const digits = (value: string): string => value.replace(/\D/g, "");

/** "01310100" → "01310-100", as the buyer types. */
function maskCep(value: string): string {
  const d = digits(value).slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

/** The CEP's lookup, asked once the eighth digit is typed. */
function useCepLookup(cep: string, lookup: CheckoutBillingLookup | undefined): { state: DebitAddress["lookup"]; found: Found } {
  const [answer, setAnswer] = useState<{ cep: string; found: Found } | null>(null);
  const complete = cep.length === 8;
  useEffect(() => {
    if (!complete || !lookup) return undefined;
    let live = true;
    lookup(cep).then(
      (found) => live && setAnswer({ cep, found }),
      () => live && setAnswer({ cep, found: null }),
    );
    return () => {
      live = false;
    };
  }, [cep, complete, lookup]);
  if (!complete || !lookup) return { state: "idle", found: null };
  if (answer?.cep !== cep) return { state: "pending", found: null };
  return { state: answer.found ? "found" : "missing", found: answer.found };
}

/** The typed address, once the CEP was found and the number (and a street) are there. */
function typedAddress(cep: string, number: string, street: string, found: Found): CheckoutBillingAddress | null {
  const road = found?.street?.trim() || street.trim();
  if (!found || !road || !number.trim()) return null;
  return { street: road, number: number.trim(), city: found.city, regionCode: found.regionCode, postalCode: cep };
}

export function DebitAddressProvider({ given, lookup, children }: {
  given: CheckoutBillingAddress | null | undefined;
  lookup: CheckoutBillingLookup | undefined;
  children: ReactNode;
}): JSX.Element {
  const [postalCode, setPostalCode] = useState("");
  const [number, setNumber] = useState("");
  const [street, setStreet] = useState("");
  const cep = digits(postalCode);
  const asks = !given && lookup !== undefined;
  const { state, found } = useCepLookup(asks ? cep : "", lookup);
  const value = useMemo<DebitAddress>(
    () => ({
      address: given ?? (asks ? typedAddress(cep, number, street, found) : null),
      asks,
      postalCode,
      setPostalCode: (next) => setPostalCode(maskCep(next)),
      number,
      setNumber,
      street,
      setStreet,
      lookup: state,
      streetKnown: Boolean(found?.street?.trim()),
    }),
    [given, asks, cep, number, street, found, postalCode, state],
  );
  return <DebitAddressContext.Provider value={value}>{children}</DebitAddressContext.Provider>;
}

/** The step's debit address; `null` outside the list (a pane composed by hand). */
export function useDebitAddress(): DebitAddress | null {
  return useContext(DebitAddressContext);
}

/** The debit card's 3-D Secure inputs when the debit row is the choice (FUT-3754), else none. */
export function useDebitRun(choice: CheckoutListChoice | null, list: CheckoutPaymentList): DebitAuthentication | undefined {
  const billingAddress = useDebitAddress()?.address ?? list.billingAddress ?? null;
  if (choice?.kind !== "online" || choice.funding !== "DEBIT" || !billingAddress || !list.copy.debit) return undefined;
  return { billingAddress, copy: list.copy.debit };
}

/** Why the debit row cannot pay yet, or `null` — the bar's reason under the button. */
export function debitAddressReason(debit: DebitAddress | null, copy: PaymentListDebitCopy | undefined): string | null {
  if (!debit?.asks || debit.address || !copy?.address) return null;
  if (debit.lookup === "missing") return copy.address.notFound;
  return copy.address.missing;
}

/** CEP, number and — when the CEP names none — the street, inside the debit row. */
export function DebitAddressFields({ copy }: { copy: PaymentListDebitCopy }): JSX.Element | null {
  const debit = useDebitAddress();
  const { Input } = useCheckoutComponents();
  const words = copy.address;
  if (!debit?.asks || !words) return null;
  const notFound = debit.lookup === "missing";
  return (
    <Box data-testid="debit-address" sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, "& > *": { flex: "1 1 140px" } }}>
        <Input
          label={words.postalCode}
          type="text"
          inputMode="numeric"
          variant="outlined"
          size="md"
          fullWidth
          autoComplete="billing postal-code"
          value={debit.postalCode}
          error={notFound}
          helperText={notFound ? words.notFound : words.hint}
          onChange={(event) => debit.setPostalCode(event.target.value)}
          data-testid="debit-address-cep"
        />
        <Input
          label={words.number}
          type="text"
          variant="outlined"
          size="md"
          fullWidth
          autoComplete="billing address-line2"
          value={debit.number}
          onChange={(event) => debit.setNumber(event.target.value)}
          data-testid="debit-address-number"
        />
      </Box>
      {debit.lookup === "found" && !debit.streetKnown ? (
        <Input
          label={words.street}
          type="text"
          variant="outlined"
          size="md"
          fullWidth
          autoComplete="billing address-line1"
          value={debit.street}
          onChange={(event) => debit.setStreet(event.target.value)}
          data-testid="debit-address-street"
        />
      ) : null}
    </Box>
  );
}
