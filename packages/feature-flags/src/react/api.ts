/**
 * How the surface reaches the backend — the HOST's authenticated client,
 * injected. The methods mirror the server routes one-to-one; a rejection's
 * `Error.message` is shown to the person as-is, so the host client should
 * surface the server's own `message` (pt-BR) rather than a transport line.
 */

import type { FlagSummary, GrantView, OrphanGrantSummary } from "../index";

export interface GrantsPage {
  readonly items: readonly GrantView[];
  readonly page: number;
  readonly perPage: number;
  readonly total: number;
}

export interface FlagsIndex {
  readonly flags: readonly FlagSummary[];
  readonly orphans: readonly OrphanGrantSummary[];
}

export interface FeatureFlagsApiClient {
  listFlags(): Promise<FlagsIndex>;
  listGrants(key: string, page: number): Promise<GrantsPage>;
  grantByEmail(key: string, input: { email: string; note?: string }): Promise<{ grant: GrantView }>;
  setGrant(
    key: string,
    userId: string,
    patch: { enabled?: boolean; note?: string | null },
  ): Promise<{ grant: GrantView }>;
  revoke(key: string, userId: string): Promise<void>;
}
