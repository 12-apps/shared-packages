import type { WireRequest, WireResponse, WireRoute } from "@12-apps/wiring";

import { BillingConfigError } from "../errors";
import { createCardVault, type CardVaultDeps, type VaultRejection } from "./vault";
import type { InstrumentCard } from "./ports";

/**
 * The card-on-file HTTP surface (FUT-340), as framework-neutral descriptors.
 *
 * Four endpoints over one flow: read the cards, open a vault session, finish
 * one, and take them all off file. They are declared here rather than written
 * once per host because the *shape* is not negotiable — the ownership check
 * that makes `complete` safe lives in `createCardVault`, and a host that
 * re-implemented the transport would be re-implementing which value reaches
 * `reference`.
 *
 * ## What a host still owns
 *
 * - **The guard.** Nothing below authenticates anybody. The host mounts these
 *   behind its own resolution and hands the resolved owner in as the actor,
 *   which is also what keeps the authorization written where a coverage gate
 *   can read it — in the host's own route file, not behind a helper.
 * - **Every sentence.** `copy` is REQUIRED and has no defaults. A default in
 *   the origin platform's language reads as finished to the next one right up
 *   until it reaches a user, and the status codes travel with the sentences
 *   because "is an unconfigured platform a 503 or a 501" is the same kind of
 *   decision.
 * - **The envelope.** A handler answers `{ status, body }`; wrapping that in
 *   the host's own response shape is the host's adapter. Failure bodies are
 *   always `{ message }`, so an adapter can map any 4xx/5xx from this surface
 *   onto its own error type without inspecting the route.
 */

/** One refusal, in the host's words and with the host's status. */
export interface HttpRefusal {
  status: number;
  message: string;
}

/** Every sentence this surface can produce. Required — see the module doc. */
export interface BillingApiCopy {
  /** Why a vault session could not be opened, by reason. */
  rejections: Readonly<Record<VaultRejection, HttpRefusal>>;
  /**
   * The provider would not co-operate with a removal AND a retry could
   * plausibly fix it — everything permanent has already dropped the pointer,
   * so this sentence should ask for exactly that.
   */
  detachFailed: HttpRefusal;
  /** The request carried no usable vault session id. */
  invalidSession: HttpRefusal;
}

/** Whoever the host resolved. The owner id is the only thing this surface reads. */
export interface BillingActor {
  /** Scopes every read and write below; the host's guard produced it. */
  ownerId: string;
}

export interface BillingApiConfig extends CardVaultDeps {
  copy: BillingApiCopy;
}

const REJECTIONS: readonly VaultRejection[] = [
  "no-platform-account",
  "no-subscription",
  "provider-cannot-vault",
];

function assertRefusal(what: string, refusal: HttpRefusal | undefined): void {
  if (!refusal) throw new BillingConfigError(`copy.${what}`, "is required; this surface ships no default copy.");
  if (!Number.isInteger(refusal.status) || refusal.status < 400 || refusal.status > 599) {
    throw new BillingConfigError(`copy.${what}.status`, "must be a 4xx or 5xx status code.");
  }
  if (refusal.message.trim() === "") {
    throw new BillingConfigError(`copy.${what}.message`, "must not be blank — a refusal with no words is a 500.");
  }
}

function assertCopy(copy: BillingApiCopy | undefined): void {
  if (!copy) throw new BillingConfigError("copy", "is required; this surface ships no default copy.");
  for (const rejection of REJECTIONS) assertRefusal(`rejections.${rejection}`, copy.rejections?.[rejection]);
  assertRefusal("detachFailed", copy.detachFailed);
  assertRefusal("invalidSession", copy.invalidSession);
}

function refuse(refusal: HttpRefusal): WireResponse {
  return { status: refusal.status, body: { message: refusal.message } };
}

/** The session id, or null when the body did not carry a usable one. */
function sessionIdOf(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const value = (body as { sessionId?: unknown }).sessionId;
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export function createApiBilling(config: BillingApiConfig): { routes: readonly WireRoute<BillingActor>[] } {
  assertCopy(config.copy);
  const vault = createCardVault(config);
  const { copy } = config;

  async function cardsOf(ownerId: string): Promise<readonly InstrumentCard[]> {
    return config.instruments.listCards(ownerId);
  }

  /** Every write answers with the resulting list, so a screen needs one call. */
  async function cardList(ownerId: string): Promise<WireResponse> {
    return { status: 200, body: { cards: await cardsOf(ownerId) } };
  }

  async function beginSession(request: WireRequest<BillingActor>): Promise<WireResponse> {
    const result = await vault.begin(request.actor.ownerId);
    if (!result.ok) return refuse(copy.rejections[result.rejection]);
    return { status: 200, body: result.start };
  }

  async function completeSession(request: WireRequest<BillingActor>): Promise<WireResponse> {
    const sessionId = sessionIdOf(request.body);
    if (!sessionId) return refuse(copy.invalidSession);

    const result = await vault.complete(request.actor.ownerId, sessionId);
    if (!result.ok) return refuse(copy.rejections[result.rejection]);
    return cardList(request.actor.ownerId);
  }

  async function forgetCards(request: WireRequest<BillingActor>): Promise<WireResponse> {
    // The only failure left by the time this returns false is one a retry can
    // actually clear — everything permanent has already dropped the pointer.
    if (!(await vault.forgetAll(request.actor.ownerId)).ok) return refuse(copy.detachFailed);
    return cardList(request.actor.ownerId);
  }

  return {
    routes: [
      {
        method: "GET",
        path: "/card",
        // Display metadata only. The provider-side vault references are never
        // selected by the store's `listCards`, so a screen cannot leak an
        // identifier it was never given.
        handle: async (request) => cardList(request.actor.ownerId),
      },
      {
        method: "POST",
        path: "/card/session",
        // The response carries a publishable key and a single-use client
        // secret. Both are meant to reach the browser — that is what they are
        // for — and neither is a credential: the client secret authorises
        // confirming ONE session and nothing else.
        handle: beginSession,
      },
      {
        method: "POST",
        path: "/card",
        // Takes ONE field, the session id, and that id is attacker-controlled:
        // it names an object at the provider rather than in the host's
        // database. What makes it safe is in `createCardVault`.
        handle: completeSession,
      },
      {
        method: "DELETE",
        path: "/card",
        // Carries NO body and names no card: the owner asks for "my card" and
        // the server resolves which rows that is, which is what keeps one owner
        // from deleting another's instrument by id. Idempotent, so it answers
        // with the (empty) list rather than a 404.
        handle: forgetCards,
      },
    ],
  };
}
