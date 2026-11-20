import { describe, expect, it } from "vitest";

import { asHarness, authorize, codeFrom, pkcePair, registerTestClient, token } from "./fixtures";
import { verifyAccessToken } from "../access-token";
import { createApiMcpOauth, type ApiMcpOauth } from "../create-api-mcp-oauth";

/**
 * A SECOND authorization server for a SECOND resource on one origin, through
 * `issuerPath` (RFC 8414 §3.1). A client reaches it through its own resource's
 * metadata, which names an issuer with a path; that issuer's metadata, codes and
 * tokens are its own, and neither surface accepts the other's.
 *
 * The first surface keeps every default: with no `issuerPath` its issuer is the
 * origin, byte for byte as before this option existed.
 */

const ORIGIN = "https://app.example.com";
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const STAFF_ISSUER_PATH = "/api/super-admin";
const STAFF_RESOURCE_PATH = "/api/super-admin/mcp";
const STAFF_PATHS = {
  authorize: "/api/super-admin/oauth/authorize",
  consent: "/api/super-admin/oauth/consent",
  token: "/api/super-admin/oauth/token",
  register: "/api/super-admin/oauth/register",
  authorizationServerMetadata: `/.well-known/oauth-authorization-server${STAFF_ISSUER_PATH}`,
  protectedResourceMetadata: `/.well-known/oauth-protected-resource${STAFF_RESOURCE_PATH}`,
};

/** Both surfaces over ONE set of stores and ONE signing key, as a host runs them. */
async function twoSurfaces(): Promise<{ store: ApiMcpOauth; staff: ApiMcpOauth }> {
  const harness = await asHarness();
  const staffSurface = createApiMcpOauth({
    stores: harness.stores,
    resolveSession: () => harness.session.current,
    signingKey: harness.api.context.signingKey,
    codeReplay: "in-process",
    resolveApproval: () => true,
    issuerPath: STAFF_ISSUER_PATH,
    resourcePath: STAFF_RESOURCE_PATH,
    paths: STAFF_PATHS,
  });
  return { store: harness.api, staff: staffSurface };
}

/** Authorize + token on one surface; answers the access token it minted. */
async function connect(api: ApiMcpOauth): Promise<string> {
  return (await connectFull(api)).accessToken;
}

/** Authorize + token on one surface; answers both tokens and the client. */
async function connectFull(api: ApiMcpOauth): Promise<{ accessToken: string; refreshToken: string; clientId: string }> {
  const { clientId } = await registerTestClient(api);
  const { verifier, challenge } = await pkcePair();
  const code = codeFrom(
    await authorize(api, {
      response_type: "code",
      client_id: clientId,
      redirect_uri: CALLBACK,
      code_challenge: challenge,
      code_challenge_method: "S256",
      scope: "mcp:read",
    }),
  );
  const response = await token(api, {
    grant_type: "authorization_code",
    code,
    redirect_uri: CALLBACK,
    code_verifier: verifier,
    client_id: clientId,
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { access_token: string; refresh_token: string };
  return { accessToken: body.access_token, refreshToken: body.refresh_token, clientId };
}

function refresh(api: ApiMcpOauth, grant: { refreshToken: string; clientId: string }): Promise<Response> {
  return token(api, { grant_type: "refresh_token", refresh_token: grant.refreshToken, client_id: grant.clientId });
}

/** A JWT's claims, read without verifying (the assertions verify separately). */
function claimsOf(jwt: string): { iss: string; aud: string } {
  return JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString("utf8"));
}

describe("an issuer path", () => {
  it("leaves the default surface's issuer as the origin, byte for byte", async () => {
    const { store } = await twoSurfaces();
    const minted = claimsOf(await connect(store));
    expect(minted).toMatchObject({ iss: ORIGIN, aud: `${ORIGIN}/api/mcp` });
    expect(store.context.issuerPath).toBe("");
  });

  it("mints the second surface's codes and tokens under its own issuer and audience", async () => {
    const surfaces = await twoSurfaces();
    const accessToken = await connect(surfaces.staff);
    expect(claimsOf(accessToken)).toMatchObject({ iss: `${ORIGIN}${STAFF_ISSUER_PATH}`, aud: `${ORIGIN}${STAFF_RESOURCE_PATH}` });
    const verified = await surfaces.staff.verifyBearer(accessToken, new Request(`${ORIGIN}${STAFF_RESOURCE_PATH}`));
    expect(verified).toMatchObject({ email: "owner@example.com" });
  });

  it("keeps the two surfaces' tokens apart, both ways", async () => {
    const { store, staff } = await twoSurfaces();
    const storeToken = await connect(store);
    const staffToken = await connect(staff);
    await expect(staff.verifyBearer(storeToken, new Request(`${ORIGIN}${STAFF_RESOURCE_PATH}`))).rejects.toThrow();
    await expect(store.verifyBearer(staffToken, new Request(`${ORIGIN}/api/mcp`))).rejects.toThrow();
    // The bare verifier a host calls for the default surface refuses it too.
    await expect(
      verifyAccessToken(store.context.signingKey, staffToken, { origin: ORIGIN }),
    ).rejects.toThrow();
  });

  it("refuses at one surface's token endpoint a code the other surface minted", async () => {
    const { store, staff } = await twoSurfaces();
    const { clientId } = await registerTestClient(store);
    const { verifier, challenge } = await pkcePair();
    const code = codeFrom(
      await authorize(store, {
        response_type: "code",
        client_id: clientId,
        redirect_uri: CALLBACK,
        code_challenge: challenge,
        code_challenge_method: "S256",
        scope: "mcp:read",
      }),
    );
    const crossed = await token(staff, {
      grant_type: "authorization_code",
      code,
      redirect_uri: CALLBACK,
      code_verifier: verifier,
      client_id: clientId,
    });
    expect(crossed.status).toBe(400);
  });

  it("keeps each surface's refresh tokens to its own token endpoint, both ways", async () => {
    const { store, staff } = await twoSurfaces();
    const staffGrant = await connectFull(staff);
    const storeGrant = await connectFull(store);
    expect((await refresh(store, staffGrant)).status).toBe(400);
    expect((await refresh(staff, storeGrant)).status).toBe(400);
    // Refused without consuming anything: each still refreshes at its own server.
    const staffNext = await refresh(staff, staffGrant);
    expect(staffNext.status).toBe(200);
    expect(claimsOf(((await staffNext.json()) as { access_token: string }).access_token).iss).toBe(`${ORIGIN}${STAFF_ISSUER_PATH}`);
    const storeNext = await refresh(store, storeGrant);
    expect(storeNext.status).toBe(200);
    expect(claimsOf(((await storeNext.json()) as { access_token: string }).access_token).iss).toBe(ORIGIN);
  });

  it("publishes each surface's own discovery: issuer, endpoints, resource", async () => {
    const { staff } = await twoSurfaces();
    const as = (await (
      await staff.handlers.authorizationServerMetadata(new Request(`${ORIGIN}${STAFF_PATHS.authorizationServerMetadata}`))
    ).json()) as Record<string, string>;
    expect(as).toMatchObject({
      issuer: `${ORIGIN}${STAFF_ISSUER_PATH}`,
      authorization_endpoint: `${ORIGIN}${STAFF_PATHS.authorize}`,
      token_endpoint: `${ORIGIN}${STAFF_PATHS.token}`,
    });
    const pr = (await (
      await staff.handlers.protectedResourceMetadata(new Request(`${ORIGIN}${STAFF_PATHS.protectedResourceMetadata}`))
    ).json()) as { resource: string; authorization_servers: string[] };
    expect(pr).toEqual(expect.objectContaining({
      resource: `${ORIGIN}${STAFF_RESOURCE_PATH}`,
      authorization_servers: [`${ORIGIN}${STAFF_ISSUER_PATH}`],
    }));
  });

  it("refuses a malformed issuer path when the surface is built", async () => {
    const harness = await asHarness();
    for (const issuerPath of ["api/staff", "/api/staff/", "/api staff", "/../x/"]) {
      expect(() =>
        createApiMcpOauth({
          stores: harness.stores,
          resolveSession: () => null,
          signingKey: harness.api.context.signingKey,
          codeReplay: "in-process",
          issuerPath,
        }),
      ).toThrow(/issuerPath/);
    }
  });
});
