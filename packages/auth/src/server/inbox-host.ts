import { promises as dns } from "node:dns";

import { inboxProviderOfDomain, type InboxHost } from "../react/screens/inbox-link";

export type { InboxHost } from "../react/screens/inbox-link";

/**
 * Which webmail a sign-up's confirmation lands in, read from the domain's MX
 * records (FUT-3806 follow-up).
 *
 * The address alone names the webmail only for the public domains
 * (`gmail.com`, `hotmail.com.br`), and the screen already knows those. A
 * company's own domain could be any of them, and only its MX says which:
 * `paladira.com` answers `mx1.titan.email`, so its people read their mail in
 * Titan. This module asks, on the server, because a browser cannot.
 *
 * ## Why it can never hurt a sign-up
 *
 * The answer is a nicety under "Confira seu e-mail": a missing one is the
 * screen as it was. So every failure — a timeout, NXDOMAIN, a resolver that
 * cannot answer MX, an MX host nobody knows — is `null`, never a throw, and
 * the lookup is capped at {@link InboxLookupConfig.timeoutMs}.
 *
 * ## Why it does not tell an account apart
 *
 * It reads the DOMAIN, never the address, and never the store. Two sign-ups
 * at one domain get the same answer whether either address is registered,
 * which is what keeps the sign-up answer identical on its two branches.
 */

/** The MX host suffixes and the webmail each means. Matched on whole labels. */
const MX_HOSTS: readonly { suffix: string; host: InboxHost }[] = [
  { suffix: "google.com", host: "google" },
  { suffix: "googlemail.com", host: "google" },
  { suffix: "mail.protection.outlook.com", host: "microsoft" },
  { suffix: "titan.email", host: "titan" },
  // Only Zoho's US data centre: an EU or India account does not sign in at
  // mail.zoho.com, and a button that opens the wrong one is worse than none.
  { suffix: "zoho.com", host: "zoho" },
  { suffix: "yahoodns.net", host: "yahoo" },
  { suffix: "mail.icloud.com", host: "icloud" },
  { suffix: "protonmail.ch", host: "proton" },
  // Locaweb's shared webmail serves every domain it hosts.
  { suffix: "locaweb.com.br", host: "locaweb" },
];

/**
 * The webmail behind a list of MX hosts, or `null` when none is known.
 *
 * The first host that matches, in the order given — a caller passes them by
 * MX priority, so a domain that routes through a filter first (`mx1.titan.email`
 * behind nothing; Google behind a Mimecast relay) is judged by what it names
 * first. Case and the trailing root dot are ignored.
 */
export function inboxHostOfMx(hosts: readonly string[]): InboxHost | null {
  for (const raw of hosts) {
    const host = raw.trim().toLowerCase().replace(/\.$/u, "");
    const match = MX_HOSTS.find(({ suffix }) => host === suffix || host.endsWith(`.${suffix}`));
    if (match) return match.host;
  }
  return null;
}

export interface InboxLookupConfig {
  /**
   * Resolve a domain's MX hosts, highest priority first. Defaults to the
   * system resolver, then DNS-over-HTTPS when {@link dohUrl} names one.
   */
  resolveMx?: (domain: string) => Promise<string[]>;
  /**
   * A DNS-over-HTTPS endpoint, in Google's JSON shape
   * (`https://dns.google/resolve`), the default resolver asks when the system
   * one has no answer. OFF unless the host names one: asking it sends every
   * sign-up's domain — the domain only, never the address — to that service,
   * and that is the host's call to make.
   */
  dohUrl?: string;
  /** How long a sign-up waits for the answer. 1000 ms. */
  timeoutMs?: number;
  /** How long an answer — a miss included — is reused. One hour. */
  ttlMs?: number;
  /** How many domains the cache holds before it drops the oldest. 1000. */
  maxEntries?: number;
}

/** Look up the webmail for an address. Never rejects. */
export type InboxLookup = (email: string) => Promise<InboxHost | null>;

/** How long a lookup that ran out of time is remembered as "no answer". */
const TIMEOUT_TTL_MS = 5 * 60 * 1000;

/** A domain worth asking about: letters, digits and hyphens in two labels or more. */
function lookupDomain(email: string): string | null {
  const parts = email.trim().toLowerCase().split("@");
  const domain = parts.length === 2 ? parts[1] : undefined;
  if (!domain || domain.length > 253) return null;
  return /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u.test(domain)
    ? domain
    : null;
}

/**
 * Domains reserved for documentation and tests (RFC 2606, RFC 6761): nothing
 * real receives mail there, so they are never looked up — which also keeps a
 * test suite's `@example.test` sign-ups off the network.
 */
function reserved(domain: string): boolean {
  return (
    /\.(test|example|invalid|localhost|local)$/u.test(domain) ||
    /(^|\.)example\.(com|net|org)$/u.test(domain)
  );
}

/** The system's MX hosts; `[]` for "no MX", a rejection for a resolver that could not answer. */
async function systemMx(domain: string, timeoutMs: number): Promise<string[]> {
  // Its own resolver, one try at the budget: the system default is
  // `timeout:2 attempts:3`, which alone can outlast the whole sign-up wait.
  const resolver = new dns.Resolver({ timeout: timeoutMs, tries: 1 });
  const records = await resolver.resolveMx(domain).catch((error: unknown) => {
    if (NO_MX.has((error as { code?: string }).code ?? "")) return [];
    throw error;
  });
  return records.sort((a, b) => a.priority - b.priority).map((record) => record.exchange);
}

interface DohAnswer {
  Answer?: { type?: number; data?: string }[];
}

async function dohMx(url: string, domain: string, timeoutMs: number): Promise<string[]> {
  const response = await fetch(`${url}?name=${encodeURIComponent(domain)}&type=MX`, {
    headers: { accept: "application/dns-json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  // A refusal or an outage is not "no MX": it throws, and is kept only briefly.
  if (!response.ok) throw new Error(`DNS-over-HTTPS answered ${response.status}`);
  const body = (await response.json()) as DohAnswer;
  return (body.Answer ?? [])
    .filter((answer) => answer.type === 15 && typeof answer.data === "string")
    .map((answer) => (answer.data ?? "").trim().split(/\s+/u))
    .filter((fields) => fields.length === 2)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map((fields) => fields[1] ?? "");
}

/** The system resolver's codes for "this domain has no MX", as opposed to "I could not ask". */
const NO_MX = new Set(["ENODATA", "ENOTFOUND"]);

/**
 * The system resolver, then DNS-over-HTTPS when one is configured.
 *
 * "No MX" from the system (`ENODATA`, `ENOTFOUND`, an empty list) falls
 * through to the fallback, because some hosting egress answers every MX query
 * with an empty `ENODATA` (measured in the cloud containers this is built in),
 * which reads exactly like a domain that has no mail. A resolver that could
 * not answer at all falls through too. Only an answer is returned as one; a
 * fallback that fails rejects, so the caller keeps it as a short-lived miss
 * rather than an hour-long "no webmail". The system gets half the budget when
 * there is a fallback to leave time for.
 */
function defaultResolver(dohUrl: string | undefined, timeoutMs: number): (domain: string) => Promise<string[]> {
  const systemBudget = dohUrl ? Math.floor(timeoutMs / 2) : timeoutMs;
  return async (domain) => {
    if (!dohUrl) return systemMx(domain, systemBudget);
    const fromSystem = await systemMx(domain, systemBudget).catch(() => []);
    if (fromSystem.length > 0) return fromSystem;
    return dohMx(dohUrl, domain, timeoutMs - systemBudget);
  };
}

/** `promise`, or `null` once `ms` have passed — the timer never holds the process open. */
function withinTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

/**
 * Bind a lookup to one configuration and its own cache.
 *
 * A public domain the screen names from the address alone is answered without
 * asking anyone; everything else asks once per domain and keeps the answer.
 */
export function createInboxLookup(config: InboxLookupConfig = {}): InboxLookup {
  const timeoutMs = config.timeoutMs ?? 1000;
  const ttlMs = config.ttlMs ?? 60 * 60 * 1000;
  const maxEntries = config.maxEntries ?? 1000;
  const resolveMx = config.resolveMx ?? defaultResolver(config.dohUrl, timeoutMs);
  const cache = new Map<string, { host: InboxHost | null; until: number }>();
  // Sign-ups at one uncached domain in the same instant share one lookup.
  const pending = new Map<string, Promise<InboxHost | null>>();

  async function ask(domain: string): Promise<InboxHost | null> {
    // `then`, so a resolver that throws synchronously still lands in the race.
    const hosts = await withinTimeout(Promise.resolve().then(() => resolveMx(domain)), timeoutMs);
    const host = hosts ? inboxHostOfMx(hosts) : null;
    // A miss that was not an answer — a timeout, a resolver that could not
    // ask — is kept for a few minutes only: long enough that a slow domain does
    // not cost every sign-up there a full wait, short enough to try again.
    const keepFor = hosts === null ? Math.min(ttlMs, TIMEOUT_TTL_MS) : ttlMs;
    cache.delete(domain);
    cache.set(domain, { host, until: Date.now() + keepFor });
    while (cache.size > maxEntries) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
    return host;
  }

  return async (email) => {
    const domain = lookupDomain(email);
    if (!domain || reserved(domain) || inboxProviderOfDomain(domain)) return null;
    const cached = cache.get(domain);
    if (cached && cached.until > Date.now()) return cached.host;
    const inFlight = pending.get(domain) ?? ask(domain).finally(() => pending.delete(domain));
    pending.set(domain, inFlight);
    return inFlight;
  };
}
