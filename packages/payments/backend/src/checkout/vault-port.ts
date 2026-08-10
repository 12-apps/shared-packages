import type { ClientTokenization, ProviderName } from '../core/types';
import type { VaultBeginInput } from '../core/vault-types';

import type { InstrumentScope } from './types';

/**
 * The buyer-vaulting vocabulary (FUT-478) — the port and the two answer shapes
 * `POST /cards/begin` and `POST /cards/complete` publish. In its own module
 * because `checkout/types.ts` sits at the size gate, exactly as the admin
 * surface keeps `VaultRequestResolvers` beside its handlers.
 */

/**
 * The OWNERSHIP facts a buyer vaulting runs under, answered by the host.
 *
 * The same rule the admin surface's `VaultRequestResolvers` enforces
 * (`http/vault-handlers.ts`): `reference` and `customerRef` are read from the
 * host's own rows — here, derived from the CALLER and the (merchant, provider)
 * scope — and NEVER from a request body, which is what ties a provider-side
 * session to one buyer rather than to whoever posts a session id.
 *
 * ONE resolver serves both routes, deliberately, where the admin surface has
 * two: `begin` plants `reference` in the session's provider-side metadata and
 * `complete` must present the same value back, so a port that could answer the
 * two requests differently would let a host break its own ownership check. The
 * library reads `reference`/`customerRef` for `complete` and the full
 * `VaultBeginInput` for `begin` from one authoritative answer.
 */
export type BuyerVaultPort<Caller> = (
  caller: Caller,
  scope: InstrumentScope,
) => Promise<VaultBeginInput>;

/**
 * What `POST /cards/begin` answers the browser — the `VaultSession` minus
 * `customerRef`, which is the host's persist-it fact (`core/vault-types.ts`)
 * and reaches `complete` through {@link BuyerVaultPort}, never through the
 * browser. Every field here exists FOR the browser: the key it encrypts with,
 * the secret it confirms against, the session it echoes back.
 */
export interface BuyerVaultSession {
  provider: ProviderName;
  tokenization: ClientTokenization;
  publicKey: string | null;
  clientSecret: string | null;
  sessionId: string | null;
}

/**
 * What `POST /cards/complete` answers, and what `SavedInstrumentPort.save`
 * receives as `display` — display metadata ONLY, consistent with what
 * `listInstruments` exposes. The vault token (`VaultedInstrument.instrumentId`)
 * is deliberately absent: it is what a later charge presents as
 * `savedCardToken`, and it travels only into the host's vault storage.
 */
export interface VaultedCardDisplay {
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
}
