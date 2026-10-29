import { cardProviderFor } from '../core/method-head';
import type { MerchantRef, ProviderName } from '../core/types';

import type { CheckoutRuntime } from './runtime';

/**
 * The ONE provider the buyer checkout's card questions name (FUT-3138): the
 * vault's ownership scope, the provider it vaults at, the saved-card list and
 * the saved-card lookup. Resolved once per request and handed on — to the
 * gateway's vault too, by name — so no two of them can disagree.
 *
 * With an adapter registry it is the chain's first card-taking link. A
 * runtime that wired none (`providers` is optional) cannot ask who takes a
 * card, so it answers the head, and every question names the head, exactly as
 * before this existed.
 */
export async function checkoutCardProvider<C, V extends object, D>(
  runtime: CheckoutRuntime<C, V, D>,
  merchant: MerchantRef,
): Promise<ProviderName | null> {
  const { providers, credentials } = runtime.config;
  return providers ? cardProviderFor({ providers, credentials }, merchant) : credentials.defaultProvider(merchant);
}
