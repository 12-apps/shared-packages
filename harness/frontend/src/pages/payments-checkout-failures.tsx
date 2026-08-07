/**
 * The three ways a card charge ends badly, and why they are three (FUT-743).
 *
 * They are NOT variations of "it failed". The order the shipped failure
 * pipeline puts them in is itself a money-safety rule, and each shape gets a
 * different screen because the wrong one causes a different harm:
 *
 *   - DECLINED — the issuer said no and nothing was captured. Say so first,
 *     then offer the retry.
 *   - PAYMENT_UNRESOLVED (409) — some provider may be HOLDING the buyer's
 *     money and nobody can prove otherwise. The pay bar is REMOVED, not merely
 *     disabled, and there is no retry affordance anywhere on the screen: paying
 *     again is the one action the message forbids, and a live "Pagar R$ …"
 *     directly under "não pague de novo" is what a thumb reaches for.
 *   - PAYMENT_UNAVAILABLE (502) — the chain is exhausted. Nothing about the
 *     buyer's data was wrong, so the sentence names the METHOD ("cartão") and
 *     points at the one that still works: the PIX tile is still on screen.
 *
 * Every one of these arrives over the wire from the real mount's own failure
 * pipeline. A page that rendered the three alerts from local state would prove
 * that the alerts exist, which nobody doubted.
 *
 * All three stores declare PIX and CARD, so the buyer picks — which is also
 * what makes the 502 case's "PIX is still there" assertion mean something.
 */
import type { JSX } from 'react';

import { checkoutCase, mintable } from '../payments/cases';
import { CaseTabs, PageIntro, type HarnessCase } from '../payments/panel';
import type { HarnessProvider } from '../payments/adapter';

/** One provider, mintable in the browser, failing in one declared way. */
function store(failure: Partial<HarnessProvider>) {
  return { chain: [mintable('aurora', ['PIX', 'CARD'], failure)] };
}

const CASES: HarnessCase[] = [
  checkoutCase('declined', 'Issuer decline', store({ declines: true })),
  // The provider failed in a way nothing can classify AND answers no probe, so
  // the walk stops rather than risk a second charge.
  checkoutCase('unresolved', 'PAYMENT_UNRESOLVED (409)', store({ ambiguous: true })),
  // Provably pre-send: the walk was entitled to advance and had nowhere to go.
  checkoutCase('unavailable', 'PAYMENT_UNAVAILABLE (502)', store({ unreachable: true })),
];

export function PaymentsCheckoutFailuresPage(): JSX.Element {
  return (
    <>
      <PageIntro title="Checkout · the three refusals">
        A decline, an unresolved charge and an exhausted chain, each raised by the real mount&apos;s
        own failure pipeline against a provider scripted to fail that way — and each answered with
        a different screen.
      </PageIntro>
      <CaseTabs cases={CASES} />
    </>
  );
}
