import { createHash } from "node:crypto";
import { importJWK, jwtVerify, SignJWT } from "jose";

import type { McpOauthContext, McpOauthSession } from "./context";
import { issuer } from "./config";
import { SIGNING_ALG } from "./keys";

/** Five minutes to read and decide; expired/interrupted flows must restart. */
export const CONSENT_TTL_SECONDS = 300;
const CONSENT_AUDIENCE = "oauth:consent";
const CONSENT_TYPE = "oauth-consent+jwt";

/** A shared atomic claim, retained until the signed ticket has expired. */
export interface ConsentReplayStore {
  /** Outages MUST refuse; no process-local fallback on a shared deployment. */
  consume(jti: string, nowMs: number, expiresAtMs: number): Promise<boolean> | boolean;
}

export interface McpOauthConsentConfig {
  /** Same-origin host UI route, outside any tenant-specific layout. */
  path: string;
  /** Keep legacy client rules as an eligibility ceiling during rollout. Even an
   * eligible/preapproved client still needs the human decision. Default false. */
  requireClientApproval?: boolean;
  /** Required explicitly: the authorization-code store has a shorter lifetime. */
  replay: ConsentReplayStore;
}

interface ConsentTicket {
  query: string;
  binding: string;
  jti: string;
  expiresAtMs: number;
}

/** Cookie-session binding only; no cookie or personal identity enters the ticket. */
export function consentSessionBinding(session: McpOauthSession): string | null {
  if (!session.sessionBinding || !session.email) return null;
  return createHash("sha256")
    .update(JSON.stringify([session.sessionBinding, session.subject, session.email]))
    .digest("hex");
}

export async function mintConsentTicket(
  context: McpOauthContext,
  session: McpOauthSession,
  query: string,
  origin: string,
): Promise<string | null> {
  const binding = consentSessionBinding(session);
  const key = await context.signingKey();
  if (!binding || !key) return null;
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ query, binding })
    .setProtectedHeader({ alg: SIGNING_ALG, kid: key.kid, typ: CONSENT_TYPE })
    .setIssuer(issuer(origin))
    .setAudience(CONSENT_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + CONSENT_TTL_SECONDS)
    .setJti(crypto.randomUUID())
    .sign(key.privateKey);
}

export async function readConsentTicket(
  context: McpOauthContext,
  ticket: string,
  origin: string,
): Promise<ConsentTicket | null> {
  if (!ticket || ticket.length > 24_000) return null;
  const key = await context.signingKey();
  if (!key) return null;
  try {
    const { payload } = await jwtVerify(ticket, await importJWK(key.publicJwk, SIGNING_ALG), {
      algorithms: [SIGNING_ALG],
      issuer: issuer(origin),
      audience: CONSENT_AUDIENCE,
      typ: CONSENT_TYPE,
      requiredClaims: ["exp", "iat", "jti"],
      maxTokenAge: CONSENT_TTL_SECONDS,
    });
    if (typeof payload.query !== "string" || typeof payload.binding !== "string" ||
      typeof payload.jti !== "string" || typeof payload.exp !== "number") return null;
    return {
      query: payload.query,
      binding: payload.binding,
      jti: payload.jti,
      expiresAtMs: payload.exp * 1000,
    };
  } catch {
    return null;
  }
}

/** Explicit single-process helper for tests/development, never an implicit default. */
export function inProcessConsentReplayStore(): ConsentReplayStore {
  const used = new Map<string, number>();
  return {
    consume(jti, nowMs, expiresAtMs) {
      for (const [key, expiry] of used) if (expiry <= nowMs) used.delete(key);
      if (expiresAtMs <= nowMs || used.has(jti)) return false;
      used.set(jti, expiresAtMs);
      return true;
    },
  };
}
