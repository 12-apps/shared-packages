import type { PaymentsGateway } from '../core/gateway';
import type { MerchantRef, ProviderName } from '../core/types';
import type { VaultBeginInput, VaultCompleteInput, VaultForgetInput } from '../core/vault-types';

import type { PaymentsHttpHandlers, PaymentsRequestContext } from './handlers';
import { guarded, json } from './responses';

/**
 * The card-vault HTTP surface (FUT-761, ported from the first adopting host).
 *
 * The gateway has exposed `beginVault`/`completeVault`/`forgetVault` since the
 * adapters grew standalone vaulting, but the mount never served them — so
 * every host hand-wrote the same three routes (the first adopting host:
 * `/subscription/card` + `card/session`), which is exactly the "second
 * acquirer adds zero host code" promise going false.
 *
 * The resolver seam exists for the same reason `resolveChargeRequest` does:
 * `reference`, `customerRef` and `instrumentId` are OWNERSHIP facts read from
 * the host's own rows, never from a request body. `begin` plants the
 * reference in the session's provider-side metadata and `complete` proves it,
 * so a session minted for a different subscription can never satisfy the
 * check — but only if the host supplied it, which this seam enforces by
 * giving the browser no field to send.
 */
export interface VaultRequestResolvers {
  /**
   * The authoritative begin input — the subscription `reference`, the tenant
   * as `customer`, and any provider customer already on file — from the
   * host's rows.
   */
  begin: (merchant: MerchantRef) => Promise<VaultBeginInput>;
  /**
   * The authoritative complete input. `sessionId` is the ONE fact the browser
   * legitimately contributes — the session it just confirmed — handed to the
   * host to pass through or refuse; everything else comes from host rows.
   */
  complete: (
    merchant: MerchantRef,
    browser: { sessionId?: string },
  ) => Promise<VaultCompleteInput>;
  /**
   * Which instrument to detach at `provider` — from the host's row. The
   * provider is NAMED by the route, not resolved to the chain head: a vault
   * id belongs to whoever minted it, and after an acquirer switch the card to
   * detach lives at yesterday's provider (see `core/gateway-vault.ts`).
   */
  forget: (merchant: MerchantRef, provider: ProviderName) => Promise<VaultForgetInput>;
}

type VaultHandlers = Pick<PaymentsHttpHandlers, 'beginVault' | 'completeVault' | 'forgetVault'>;

/** The three vault endpoints; all 404 when no resolvers are wired. */
export function makeVaultHandlers(
  gateway: PaymentsGateway,
  resolvers: VaultRequestResolvers | undefined,
): VaultHandlers {
  const noVault = (): Response =>
    json({ error: 'NotFound', message: 'Card vaulting is not enabled' }, 404);

  return {
    beginVault: (ctx: PaymentsRequestContext) =>
      guarded(async () => {
        if (!resolvers) return noVault();
        const input = await resolvers.begin(ctx.merchant);
        return json(await gateway.beginVault(ctx.merchant, input));
      }),

    completeVault: (request: Request, ctx: PaymentsRequestContext) =>
      guarded(async () => {
        if (!resolvers) return noVault();
        // A body-less complete is legal (PagBank's completes off the begin
        // alone; only Stripe-style flows carry a confirmed session id), so a
        // missing or non-JSON body degrades to {} rather than refusing.
        const body = (await request.json().catch(() => ({}))) as { sessionId?: unknown };
        const input = await resolvers.complete(ctx.merchant, {
          sessionId: typeof body.sessionId === 'string' ? body.sessionId : undefined,
        });
        return json(await gateway.completeVault(ctx.merchant, input));
      }),

    forgetVault: (ctx: PaymentsRequestContext, provider: ProviderName) =>
      guarded(async () => {
        if (!resolvers) return noVault();
        const input = await resolvers.forget(ctx.merchant, provider);
        await gateway.forgetVault(ctx.merchant, provider, input);
        return json({ forgotten: true });
      }),
  };
}
