import { describe, expect, it } from "vitest";

import type { FetchMetadataDocument, MetadataDocumentAnswer } from "../client-metadata";
import { asHarness, authorize, pkcePair, registerTestClient } from "./fixtures";

/**
 * The edges of RFC 9207's `iss` (FUT-4523) the first suite left open: a trusted
 * forwarded origin names ITSELF, a callback cannot plant its own `iss`, and a
 * metadata-document client gets the same issuer as a registered one.
 */

const ORIGIN = "https://app.example.com";
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";

async function query(clientId: string, redirectUri = CALLBACK): Promise<Record<string, string>> {
  const { challenge } = await pkcePair();
  return {
    response_type: "code", client_id: clientId, redirect_uri: redirectUri,
    code_challenge: challenge, code_challenge_method: "S256", scope: "mcp:read", state: "st-1",
  };
}

function issOf(response: Response): string[] {
  const location = response.headers.get("location");
  if (!location) throw new Error("no redirect");
  return new URL(location).searchParams.getAll("iss");
}

describe("iss at the edges", () => {
  it("names a trusted forwarded origin itself, the issuer its metadata serves", async () => {
    const harness = await asHarness({ trustedOrigins: ["https://public.example.com", "https://second.example.com"] });
    const { clientId } = await registerTestClient(harness.api);
    const headers = { "x-forwarded-host": "second.example.com", "x-forwarded-proto": "https" };
    const url = new URL(`${ORIGIN}/api/oauth/authorize?${new URLSearchParams(await query(clientId))}`);
    const response = await harness.api.handlers.authorize(new Request(url, { headers }));
    const metadata = await harness.api.handlers.authorizationServerMetadata(
      new Request(`${ORIGIN}/.well-known/oauth-authorization-server`, { headers }),
    );
    const served = ((await metadata.json()) as { issuer: string }).issuer;
    expect(served).toBe("https://second.example.com");
    expect(issOf(response)).toEqual([served]);
  });

  it("replaces an iss the registered callback carries, so a client cannot name another issuer", async () => {
    const harness = await asHarness();
    const planted = `${CALLBACK}?iss=https%3A%2F%2Fevil.example.com`;
    const { clientId } = await registerTestClient(harness.api, { redirect_uris: [planted] });
    const response = await authorize(harness.api, await query(clientId, planted));
    expect(issOf(response)).toEqual([ORIGIN]);
  });

  it("names the same issuer to a metadata-document client", async () => {
    const clientId = "https://claude.ai/oauth/mcp-oauth-client-metadata";
    const document = {
      client_id: clientId, client_name: "Claude", redirect_uris: [CALLBACK],
      grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none",
    };
    const fetchDocument = (async (): Promise<MetadataDocumentAnswer> =>
      ({ status: 200, body: JSON.stringify(document) })) as FetchMetadataDocument;
    const harness = await asHarness({ clientIdMetadataDocuments: { fetchDocument } });
    const response = await authorize(harness.api, await query(clientId));
    expect(new URL(response.headers.get("location") ?? "").searchParams.get("code")).toBeTruthy();
    expect(issOf(response)).toEqual([ORIGIN]);
  });
});
