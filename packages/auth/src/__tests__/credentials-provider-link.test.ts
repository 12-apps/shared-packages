import { describe, expect, it, vi } from "vitest";

import { credentialsProvider } from "../credentials-provider";
import type { AuthenticateResult } from "../email-credentials/types";
import { SIGNUP_BINDING_COOKIE } from "../server/auth-cookies";

/**
 * The provider's second way in (FUT-3474): a submission carrying `linkToken`
 * is a confirmation link being turned into a session, and the binding must
 * come off the request's own cookie — never off the form, which the page could
 * fill with anything.
 */

type Authorize = (credentials: Record<string, unknown>, request: Request) => Promise<unknown>;

function authorizeOf(provider: ReturnType<typeof credentialsProvider>): Authorize {
  return (provider as unknown as { options: { authorize: Authorize } }).options.authorize;
}

const ANA: AuthenticateResult = { ok: true, user: { id: "u1", email: "ana@example.com" } };

function requestWith(cookie?: string): Request {
  return new Request("http://host/api/auth/callback/credentials", {
    method: "POST",
    headers: cookie ? { cookie } : {},
  });
}

describe("credentialsProvider with a link token", () => {
  it("hands the token and the cookie's binding to authenticateLink", async () => {
    const authenticateLink = vi.fn(async () => ANA);
    const authenticate = vi.fn(async () => ANA);
    const authorize = authorizeOf(credentialsProvider({ authenticate, authenticateLink }));

    const user = await authorize(
      { linkToken: "tok", binding: "from-the-form" },
      requestWith(`other=1; ${SIGNUP_BINDING_COOKIE}=bound`),
    );

    expect(user).toMatchObject({ id: "u1", email: "ana@example.com" });
    expect(authenticateLink).toHaveBeenCalledWith("tok", "bound");
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("passes no binding when the browser has no cookie", async () => {
    const authenticateLink = vi.fn(async (): Promise<AuthenticateResult> => ({ ok: false, reason: "token-invalid" }));
    const authorize = authorizeOf(credentialsProvider({ authenticate: vi.fn(), authenticateLink }));

    await expect(authorize({ linkToken: "tok" }, requestWith())).rejects.toMatchObject({ code: "token-invalid" });
    expect(authenticateLink).toHaveBeenCalledWith("tok", undefined);
  });

  it("refuses a link token when the host wired no authenticateLink", async () => {
    const authorize = authorizeOf(credentialsProvider({ authenticate: vi.fn(async () => ANA) }));
    await expect(authorize({ linkToken: "tok" }, requestWith("x=1"))).rejects.toMatchObject({
      code: "token-invalid",
    });
  });

  it("still signs in with an e-mail and a password", async () => {
    const authenticate = vi.fn(async () => ANA);
    const authorize = authorizeOf(credentialsProvider({ authenticate }));
    await expect(authorize({ email: "ana@example.com", password: "p" }, requestWith())).resolves.toMatchObject({ id: "u1" });
  });
});
