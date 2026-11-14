import type { EngineContext } from "./context";
import { MessagingConnectError } from "./errors";
import type { ConnectionView } from "./types";

export interface ConnectInput {
  tenantId: string;
  channel: string;
  /** The channel's id for the account (WhatsApp's phone_number_id). */
  externalAccountId: string;
  /** The channel's parent account (WhatsApp's WABA id), when it has one. */
  externalParentId?: string | null;
  displayAddress: string;
  /** The credential in clear (a business token). Sealed here; never stored, returned or logged in clear. */
  credential: string;
}

/**
 * Connect an account to a tenant. The account is UNIQUE across tenants: one
 * held by another tenant (connected, or in error) is refused
 * (`ACCOUNT_TAKEN`); only one that tenant revoked may be connected by another,
 * who proves it through the channel's own signup. Re-connecting one's own
 * account replaces its credential and clears its error.
 */
export async function connect(ctx: EngineContext, input: ConnectInput): Promise<ConnectionView> {
  const { store, secrets, clock } = ctx.config;
  if (!ctx.adapters.has(input.channel)) {
    throw new MessagingConnectError("UNKNOWN_CHANNEL", `no adapter for channel "${input.channel}"`);
  }
  const existing = await store.findConnectionByAccount(input.channel, input.externalAccountId);
  if (existing && existing.tenantId !== input.tenantId && existing.status !== "REVOKED") {
    throw new MessagingConnectError("ACCOUNT_TAKEN", `account ${input.externalAccountId} is held by another tenant`);
  }
  return store.saveConnection({
    tenantId: input.tenantId,
    channel: input.channel,
    externalAccountId: input.externalAccountId,
    externalParentId: input.externalParentId ?? null,
    displayAddress: input.displayAddress,
    credentialSealed: await secrets.seal(input.credential),
    connectedAt: clock.now(),
  });
}

/** Revoke a tenant's connection: inbound traffic for it is dropped and sends are refused. */
export async function revoke(ctx: EngineContext, tenantId: string, connectionId: string, reason: string | null = null) {
  return ctx.config.store.setConnectionStatus(tenantId, connectionId, {
    status: "REVOKED",
    statusReason: reason,
    revokedAt: ctx.config.clock.now(),
  });
}

/** Mark a connection in error (a token the channel rejects): treated as revoked until re-connected. */
export async function markError(ctx: EngineContext, tenantId: string, connectionId: string, reason: string) {
  return ctx.config.store.setConnectionStatus(tenantId, connectionId, {
    status: "ERROR",
    statusReason: reason.slice(0, 500),
    revokedAt: null,
  });
}
