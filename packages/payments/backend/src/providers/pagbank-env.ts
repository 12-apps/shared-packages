import { pagbankApiBase } from './pagbank-api-base';

/**
 * The environment PagBank is configured from, when a deployment configures it
 * that way (FUT-764).
 *
 * Which variables carry a PagBank credential is the ADAPTER's fact, by exactly
 * the argument {@link pagbankApiBase} makes about the hostnames: the names are
 * the same for every deployment, they are PagBank's own vocabulary prefixed
 * with the adapter's, and a host restating them is restating the adapter's job.
 * The first adopting host had a hand-rolled reader for all four — one more copy
 * of a table only this package can be authoritative about.
 *
 * What is NOT here is where the values come from. `env` is passed in rather
 * than read off `process.env` inside the package, so a test, a job and a
 * request path can each answer for themselves and nothing in a payments package
 * reaches for ambient global state.
 *
 * Read at CALL time by the host, never cached across requests, so a rotated
 * secret is picked up. Secrets live only in the environment: never in the
 * database, never in the repo.
 */

/** Whatever carries the variables — `process.env`, or a test's own record. */
export type PagBankEnvSource = Readonly<Record<string, string | undefined>>;

export interface PagBankEnv {
  /** Server bearer token for the Orders API. Absent ⇒ the client runs in stub mode. */
  token: string | null;
  /** Public key handed to the browser SDK for client-side card tokenization. */
  publicKey: string | null;
  /** Shared secret used to authenticate inbound webhook deliveries. */
  webhookToken: string | null;
  /** Orders API base URL. */
  apiBase: string;
}

function nonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * The four env-token values, with SANDBOX as the base URL's default.
 *
 * This is the seam `pagbankApiBase` refuses to be. That helper takes a required
 * environment precisely so nothing guesses silently — and it says the caller
 * wanting a safe fallback must resolve the environment and SAY SO at its own
 * seam. This is that seam, and it says so: a deployment that forgot to
 * configure a base talks to sandbox, never to live. Getting that backwards puts
 * a real card through a real account by accident.
 */
export function readPagBankEnv(env: PagBankEnvSource): PagBankEnv {
  return {
    token: nonEmpty(env.PAGBANK_TOKEN),
    publicKey: nonEmpty(env.PAGBANK_PUBLIC_KEY),
    webhookToken: nonEmpty(env.PAGBANK_WEBHOOK_TOKEN),
    apiBase: nonEmpty(env.PAGBANK_API_BASE) ?? pagbankApiBase('SANDBOX'),
  };
}

/**
 * Whether the global env token may stand in as a PLATFORM FALLBACK for a store
 * with no enabled connection of its own.
 *
 * Off in production unless asked for, and that default is the whole reason this
 * is a function rather than a flag read: production must charge into each
 * store's OWN account, never a shared platform token, and a deployment that
 * has not thought about it must get the safe answer. Outside production it is
 * on, so a local or CI checkout exercises the full checkout flow without
 * per-store setup.
 *
 * `PAGBANK_PLATFORM_FALLBACK` forces it either way ("1"/"true", "0"/"false");
 * anything else falls through to the environment rule, because a typo in a flag
 * must not read as an instruction.
 */
export function pagbankPlatformFallbackEnabled(env: PagBankEnvSource): boolean {
  const flag = env.PAGBANK_PLATFORM_FALLBACK?.trim().toLowerCase();
  if (flag === '1' || flag === 'true') return true;
  if (flag === '0' || flag === 'false') return false;
  return env.NODE_ENV !== 'production';
}
