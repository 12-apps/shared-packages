import { describe, expect, it } from "vitest";

import { bearerChallenge, buildProtectedResourceMetadata } from "./resource-metadata";

describe("buildProtectedResourceMetadata", () => {
  it("emits the RFC 9728 fields", () => {
    const meta = buildProtectedResourceMetadata({
      resource: "https://app.example.com/api/mcp",
      authorizationServers: ["https://app.example.com"],
      scopesSupported: ["mcp:read"],
    });
    expect(meta).toEqual({
      resource: "https://app.example.com/api/mcp",
      authorization_servers: ["https://app.example.com"],
      bearer_methods_supported: ["header"],
      scopes_supported: ["mcp:read"],
    });
  });

  it("omits scopes when not provided", () => {
    const meta = buildProtectedResourceMetadata({
      resource: "r",
      authorizationServers: ["a"],
    });
    expect(meta.scopes_supported).toBeUndefined();
  });
});

describe("bearerChallenge", () => {
  it("points at the resource metadata and carries the error", () => {
    const challenge = bearerChallenge({
      resourceMetadataUrl: "https://app.example.com/.well-known/oauth-protected-resource",
      error: "invalid_token",
      errorDescription: "expired",
    });
    expect(challenge).toBe(
      'Bearer resource_metadata="https://app.example.com/.well-known/oauth-protected-resource", error="invalid_token", error_description="expired"',
    );
  });

  it("emits a bare challenge when no error is given", () => {
    expect(bearerChallenge({ resourceMetadataUrl: "https://x/.well-known/oauth-protected-resource" })).toBe(
      'Bearer resource_metadata="https://x/.well-known/oauth-protected-resource"',
    );
  });
});
