import type { MaskedProviderConfig } from '@12-apps/payments-backend';

/**
 * Is there actually a connection here?
 *
 * The one definition, because the screen shipped with two. Disconnecting does
 * NOT delete the row — it empties every environment's credentials and resets
 * the status — so `config !== null` keeps answering "yes" for a store that has
 * nothing left to charge with. The provider list said `Conectado` while the
 * panel one click away offered `Conectar com PagBank`.
 *
 * `RECONNECT_REQUIRED` counts as connected on purpose: that store demonstrably
 * worked and still holds credentials, it is the AUTHORIZATION that lapsed.
 */
export function isConnected(config: MaskedProviderConfig | null | undefined): boolean {
  const status = config?.status;
  return status === 'VERIFIED' || status === 'RECONNECT_REQUIRED';
}

/**
 * Is there enough here to attempt the activation charge?
 *
 * Deliberately NOT {@link isConnected}. That reads `status`, which only the
 * credential PROBE sets — so a store that had pasted perfectly good keys saw no
 * activation step at all until it ran "Testar conexão" first, and for a
 * key-based provider that probe answers a question nobody asked. The charge is
 * the real test; making it wait behind a weaker one is backwards.
 *
 * Credentials in the ACTIVE environment are the bar, plus `isConnected` for the
 * OAuth case, where the grant is the credential and no field is ever filled in.
 */
export function canAttemptCharge(config: MaskedProviderConfig | null | undefined): boolean {
  if (!config) return false;
  if (isConnected(config)) return true;
  // Credentials alone are NOT enough for a provider whose activation charge is
  // a real payment. Offering "Pagar R$1,01 e ativar" beside an UNVERIFIED tag
  // invites an owner to send real money through a handle nothing has checked —
  // and a mistyped InfiniteTag pays a stranger, irreversibly. It also put the
  // step-3 card on screen while the walkthrough was still saying "step 2: go
  // enable Checkout", which is two answers to "what do I do now".
  //
  // The probe is one click and costs nothing, so requiring it first takes away
  // no capability — it just orders the two steps the way the guide already
  // describes them.
  if (config.chargeVerifiedAt) return true;
  return false;
}

/** What a provider card reports at a glance. */
type ConnectionBadge =
  | { label: 'Ativo'; color: 'success' }
  | { label: 'Conectado'; color: 'default' }
  | { label: 'Reconectar'; color: 'error' }
  | { label: 'Não conectado'; color: 'warning' };

/**
 * `enabled` is deliberately checked first: it is the only state that means
 * money can move, and a store reading `Ativo` has already passed everything
 * below it.
 */
export function connectionBadge(config: MaskedProviderConfig | null): ConnectionBadge {
  if (config?.enabled) return { label: 'Ativo', color: 'success' };
  if (config?.status === 'RECONNECT_REQUIRED') return { label: 'Reconectar', color: 'error' };
  if (isConnected(config)) return { label: 'Conectado', color: 'default' };
  return { label: 'Não conectado', color: 'warning' };
}
