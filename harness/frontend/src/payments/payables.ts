/**
 * THE HOST'S PAYABLES (FUT-743) — a BOOK of them, not one mutable object.
 *
 * ## Why a map, and why it is not a detail
 *
 * The mount refuses a CARD charge raised against a PIX payable and answers it
 * `PAYABLE_NOT_FOUND`. That is FUT-740's first critical and it is a money rule,
 * not a validation nicety: the buyer is holding a live QR for that payable, so
 * settling it with a card leaves a scannable code still pointing at a
 * chargeable one — two payable codes for one payable, the double payment
 * `checkout/reuse.ts` exists to prevent.
 *
 * This harness could not reach that rule while the store held ONE payable that
 * `create` rewrote in place: whatever method the newest request asked for
 * became the payable's method, so the gate's two sides always agreed and it
 * never fired. Deleting it from the published tarball left every page green —
 * which is the one outcome a harness whose module doc names that defect cannot
 * have.
 *
 * So a create MINTS, at its own ref, and every payable already raised stays
 * exactly as it was. The buyer who raises a PIX code and then switches to card
 * leaves a live PIX payable behind, and that payable is now a reachable target
 * for a card charge — see `pages/payments-checkout-method-gate.tsx`.
 */
import type { MemoryChargeStore, Payable, PaymentMethodKind } from '@12-apps/payments-backend';

import { BRL, MERCHANT, brlLabel } from './adapter';
import type { HarnessStoreSpec } from './store';

/** The host's own body for a payable — echoed verbatim, never read by the library. */
export interface HarnessView {
  invoice: string;
  total: number;
  totalLabel: string;
  pix?: { copyPaste: string; expiresAt: string };
  hostedCheckoutUrl?: string;
}

/** Every payable one store has, and how many it has minted. */
export interface PayableBook {
  /** By the ref the host minted it under. `load` is a lookup in here. */
  byRef: Map<string, Payable>;
  /** What every mint is a copy of. Never itself mutated. */
  template: Payable;
  /** How many creates have happened; the next mints `refAt(minted)`. */
  minted: number;
}

/**
 * `inv_harness_0043`, `inv_harness_0044`, … — an INVOICE handle, deliberately:
 * nothing order-shaped reaches the mount, which is the falsifiable half of the
 * FUT-740 design.
 */
function refAt(index: number): string {
  return `inv_harness_${String(43 + index).padStart(4, '0')}`;
}

/**
 * The store's payables before anything has happened to them.
 *
 * A payable already SETTLED is the store a buyer comes back to from a hosted
 * provider — the webhook landed while they were away. The FIRST create mints
 * that same seed ref on purpose: a page's first payable is `inv_harness_0043`
 * whether it was seeded or raised, which is what makes the handle parked on one
 * page load resolvable on the next.
 */
export function seedPayables(
  spec: Pick<HarnessStoreSpec, 'amountCents' | 'customer' | 'settled'>,
): PayableBook {
  const template: Payable = {
    ref: refAt(0),
    merchant: MERCHANT,
    amount: BRL(spec.amountCents ?? 7500),
    method: 'PIX',
    customer: spec.customer ?? { name: 'Ana Compradora', email: 'ana@exemplo.com' },
    state: spec.settled ? 'SETTLED' : 'OPEN',
  };
  return { byRef: new Map([[template.ref, template]]), template, minted: 0 };
}

/** The host's view of one payable, including the PIX payload just raised. */
function viewOf(payable: Payable, charges: MemoryChargeStore): HarnessView {
  const raised = charges
    .all()
    .filter((stored) => stored.snapshot.reference?.startsWith(payable.ref))
    .at(-1);
  const snapshot = raised?.snapshot;
  return {
    invoice: payable.ref,
    total: payable.amount.amountCents,
    totalLabel: brlLabel(payable.amount.amountCents),
    ...(snapshot?.pix?.qrText
      ? {
          pix: {
            copyPaste: snapshot.pix.qrText,
            expiresAt: snapshot.pix.expiresAt ?? new Date(Date.now() + 15 * 60_000).toISOString(),
          },
        }
      : {}),
    ...(snapshot?.hostedCheckoutUrl ? { hostedCheckoutUrl: snapshot.hostedCheckoutUrl } : {}),
  };
}

/** Replace one payable. A container's entry is moved, never a binding. */
function rewrite(book: PayableBook, ref: string, patch: Partial<Payable>): void {
  const current = book.byRef.get(ref);
  if (current) book.byRef.set(ref, { ...current, ...patch });
}

/**
 * The host's payable port.
 *
 * `create` reads the METHOD and the BUYER off its own request body — the CPF in
 * particular, which the payable has no column for and which can therefore only
 * arrive with the request that raises it. That is FUT-740's third critical,
 * stated as a host contract rather than as a library rule.
 */
export function payablesPort(book: PayableBook, charges: MemoryChargeStore) {
  return {
    load: async (_caller: unknown, ref: string) => book.byRef.get(ref) ?? null,
    create: async (_caller: unknown, body: unknown) => {
      const draft = body as {
        method?: PaymentMethodKind;
        buyer?: { name?: string; email?: string; taxId?: string; phone?: string };
      };
      const payable: Payable = {
        ...book.template,
        ref: refAt(book.minted),
        method: draft.method ?? 'PIX',
        customer: { ...book.template.customer, ...draft.buyer },
      };
      book.minted += 1;
      book.byRef.set(payable.ref, payable);
      return { payable, view: viewOf(payable, charges) };
    },
    view: async (ref: string) => {
      const payable = book.byRef.get(ref);
      return payable ? viewOf(payable, charges) : null;
    },
    stateToken: (payable: Payable) => (payable.state === 'OPEN' ? 'AWAITING_PAYMENT' : 'PAID'),
  };
}

/**
 * The host's own settlement writes, applied to the payable the REF names.
 *
 * Reading the ref matters now that several payables can exist at once: a
 * settlement that always wrote to "the" payable would mark the one the buyer
 * abandoned as paid, which is the same class of error the method gate refuses.
 */
export function correlationPort(book: PayableBook) {
  return {
    attachPending: async () => undefined,
    recordCardOutcome: async ({ ref, approved }: { ref: string; approved: boolean }) => {
      rewrite(book, ref, { state: approved ? 'SETTLED' : 'CLOSED' });
      return approved ? 'PAID' : 'FAILED';
    },
    settle: async ({ ref }: { ref: string }) => {
      rewrite(book, ref, { state: 'SETTLED' });
      return 'PAID';
    },
  };
}
