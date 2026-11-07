import { mintCode } from "./authorization-code";
import type { McpOauthContext, McpOauthSession } from "./context";
import { callbackRedirect, errorRedirect, type ValidatedAuthorize } from "./authorize-request";

/** Issue only after a caller has authenticated and explicitly approved. */
export async function mintAuthorization(
  context: McpOauthContext,
  session: McpOauthSession,
  origin: string,
  validated: ValidatedAuthorize,
): Promise<Response> {
  const code = await mintCode(context.signingKey, {
    // The subject is the OAuth `sub` the host resolved, NOT a DB id: downstream
    // guards resolve the user by EMAIL, and the code carries only what the session
    // verified.
    sub: session.subject || session.email,
    email: session.email,
    clientId: validated.clientId,
    redirectUri: validated.redirectUri,
    codeChallenge: validated.codeChallenge,
    scope: validated.scope,
    origin,
  });

  if (!code) {
    // No signing key configured while the surface is on — refuse to issue rather
    // than fall back to a weaker mode (safe-by-default).
    return errorRedirect(validated, "server_error");
  }

  return callbackRedirect(validated, { code });
}
