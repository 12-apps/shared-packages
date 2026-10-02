import type { McpOauthContext } from "./context";
import { errorRedirect, redirectTo, validateAuthorization } from "./authorize-request";
import { mintAuthorization } from "./authorize-response";
import { beginConsent } from "./consent";

/** GET authorize validates the callback before any redirect, then authenticates. */
export async function authorizeEndpoint(
  context: McpOauthContext,
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  const origin = context.originOf(request);
  const validated = await validateAuthorization(context, url, origin);
  if (validated instanceof Response) return validated;
  const session = await context.resolveSession(request);
  if (!session?.email) {
    const loginUrl = new URL(context.loginPath, origin);
    loginUrl.searchParams.set(context.loginCallbackParam, url.pathname + url.search);
    return redirectTo(loginUrl.toString());
  }
  const scopes = validated.scope.split(/\s+/).filter(Boolean);
  if (context.consent) {
    if (context.consent.requireClientApproval &&
      !(await context.approve(request, validated.client, scopes))) {
      return errorRedirect(validated.redirectUri, "access_denied", validated.state);
    }
    // Eligibility can narrow who reaches consent, never approve on their behalf.
    return beginConsent(context, session, url, origin);
  }
  if (!(await context.approve(request, validated.client, scopes))) {
    return errorRedirect(validated.redirectUri, "access_denied", validated.state);
  }
  return mintAuthorization(context, session, origin, validated);
}
