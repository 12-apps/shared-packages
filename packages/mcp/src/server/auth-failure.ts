/**
 * What an unauthorized MCP call is TOLD, as opposed to what it is refused with.
 *
 * ## The failure this module exists to remove
 *
 * A resource server has three RFC 6750 challenge codes and a boolean's worth of
 * expressiveness, so every way a bearer can fail arrives at the agent as one
 * opaque refusal. `Authentication required` is what a lapsed connection, a token
 * minted for a different origin, a surface an operator never switched on, and a
 * missing scope all look like — identical, and none of them actionable.
 *
 * The cost is not cosmetic. An agent that cannot tell those apart cannot tell the
 * user anything useful either: every tool call fails, the connector still reports
 * itself connected, and the one thing that would fix the common case — reconnect
 * it — is the one thing nobody is told to do. Reported from a live deployment as
 * "every tool call failing, even the ones that read nothing".
 *
 * ## The shape of the answer
 *
 * Each reason resolves to three things, and they are deliberately separate:
 *
 *   - `challenge` — the RFC 6750 code for the `WWW-Authenticate` header. Only
 *     ever one of the two the spec defines for this situation, because a host's
 *     OAuth machinery keys off it;
 *   - `action` — what would actually fix it, for a client that automates;
 *   - `message` — one sentence an agent can relay to a person. English, like
 *     everything else a developer or a model reads here; a host that wants its
 *     own wording supplies it.
 *
 * Nothing here narrows `unverified`. Signature, issuer and audience stay
 * collapsed into one answer on purpose — see `../oauth/access-token.ts` for why
 * expiry is the single documented exception.
 */

/** Why a call was refused, across both the transport and the token verifier. */
export type McpAuthFailureReason =
  /** No `Authorization` header at all — the client has not connected yet. */
  | "no_token"
  /** The token was fine until its `exp` passed. The common one, and recoverable. */
  | "expired"
  /** Signature, issuer or audience did not hold. Deliberately not narrowed. */
  | "unverified"
  /** Verified, but carrying no usable identity. */
  | "incomplete"
  /** The operator has not provisioned signing material, so nothing can verify. */
  | "not_provisioned"
  /** The whole MCP surface is switched off for this deployment. */
  | "surface_disabled"
  /** A valid token that lacks the scope this particular call needs. */
  | "insufficient_scope";

/** What a client should do about it. */
export type McpAuthRecovery =
  /** Exchange the refresh token for a new access token, then retry. */
  | "refresh"
  /** Re-run the authorization flow — a human has to approve it again. */
  | "reconnect"
  /** Nothing the client can do; the deployment has to change. */
  | "contact_operator";

/** The resolved answer for one refusal. */
export interface McpAuthFailure {
  reason: McpAuthFailureReason;
  /** The RFC 6750 code for the `WWW-Authenticate` challenge. */
  challenge: "invalid_token" | "insufficient_scope";
  action: McpAuthRecovery;
  /** One sentence, written to be relayed to a person by an agent. */
  message: string;
}

const FAILURES: Record<McpAuthFailureReason, Omit<McpAuthFailure, "reason">> = {
  no_token: {
    challenge: "invalid_token",
    action: "reconnect",
    message:
      "This request carried no access token. Ask the user to connect this MCP server in their assistant's connector settings, then retry.",
  },
  expired: {
    challenge: "invalid_token",
    action: "refresh",
    message:
      "The access token has expired. A client that holds a refresh token should renew it and retry; if renewal also fails, ask the user to reconnect this MCP server in their assistant's connector settings.",
  },
  unverified: {
    challenge: "invalid_token",
    action: "reconnect",
    message:
      "The access token could not be verified for this server. Ask the user to reconnect this MCP server in their assistant's connector settings — a token issued for a different deployment will never verify here.",
  },
  incomplete: {
    challenge: "invalid_token",
    action: "reconnect",
    message:
      "The access token verified but carries no usable identity. Ask the user to reconnect this MCP server in their assistant's connector settings.",
  },
  not_provisioned: {
    challenge: "invalid_token",
    action: "contact_operator",
    message:
      "This server has no signing key provisioned, so no access token can be verified. Reconnecting will not help; the deployment's operator has to configure it.",
  },
  surface_disabled: {
    challenge: "invalid_token",
    action: "contact_operator",
    message:
      "The MCP surface is switched off on this deployment. Reconnecting will not help; the deployment's operator has to enable it.",
  },
  insufficient_scope: {
    challenge: "insufficient_scope",
    action: "reconnect",
    message:
      "The access token does not grant the scope this tool needs. Ask the user to reconnect this MCP server and approve the wider scope.",
  },
};

/** Resolve a reason to its challenge code, recovery and human-relayable message. */
export function describeAuthFailure(reason: McpAuthFailureReason): McpAuthFailure {
  return { reason, ...FAILURES[reason] };
}

/**
 * The machine-readable half, carried in the JSON-RPC error's `data` member.
 *
 * A model reads `message`; a host that automates its connection lifecycle reads
 * this. Both travel together so neither has to be inferred from the other.
 */
export interface McpAuthFailureData {
  reason: McpAuthFailureReason;
  action: McpAuthRecovery;
  /**
   * Whether presenting a NEW token could succeed. `false` means the deployment
   * itself is the problem, so a client that retries forever is wasting its time
   * and the user's — and should say so rather than loop.
   */
  recoverable: boolean;
}

/** Build the `data` payload for a refusal. */
export function authFailureData(failure: McpAuthFailure): McpAuthFailureData {
  return {
    reason: failure.reason,
    action: failure.action,
    recoverable: failure.action !== "contact_operator",
  };
}
