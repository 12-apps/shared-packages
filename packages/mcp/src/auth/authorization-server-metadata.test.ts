import { describe, expect, it } from "vitest";

import { buildAuthorizationServerMetadata } from "./authorization-server-metadata";
// Barrel import (deliverable 2.2): the builder must be re-exported from the
// package entry so the future `@12-apps/mcp` extraction inherits both halves.
import { buildAuthorizationServerMetadata as buildFromBarrel } from "../index";

describe("buildAuthorizationServerMetadata", () => {
  it("derives every endpoint from the issuer and fixes the RFC 8414 arrays", () => {
    const meta = buildAuthorizationServerMetadata({
      issuer: "https://app.example.com",
      scopesSupported: ["mcp:read", "mcp:write"],
    });

    expect(meta.issuer).toBe("https://app.example.com");
    expect(meta.authorization_endpoint).toBe(
      "https://app.example.com/api/oauth/authorize",
    );
    expect(meta.token_endpoint).toBe("https://app.example.com/api/oauth/token");
    expect(meta.registration_endpoint).toBe(
      "https://app.example.com/api/oauth/register",
    );
    expect(meta.jwks_uri).toBe("https://app.example.com/.well-known/jwks.json");

    // Fixed per the OAuth 2.1 + PKCE contract — must never drift.
    expect(meta.response_types_supported).toEqual(["code"]);
    expect(meta.grant_types_supported).toEqual([
      "authorization_code",
      "refresh_token",
    ]);
    expect(meta.code_challenge_methods_supported).toEqual(["S256"]);
    expect(meta.token_endpoint_auth_methods_supported).toEqual([
      "none",
      "client_secret_basic",
    ]);
  });

  it("passes the supplied scopes through to scopes_supported", () => {
    const meta = buildAuthorizationServerMetadata({
      issuer: "https://tenant.example.com",
      scopesSupported: ["mcp:read"],
    });

    expect(meta.scopes_supported).toEqual(["mcp:read"]);
    // Endpoints stay on the supplied issuer origin.
    expect(meta.issuer).toBe("https://tenant.example.com");
    expect(meta.authorization_endpoint).toBe(
      "https://tenant.example.com/api/oauth/authorize",
    );
  });

  it("honours a custom token_endpoint_auth_methods override", () => {
    const meta = buildAuthorizationServerMetadata({
      issuer: "https://app.example.com",
      scopesSupported: ["mcp:read", "mcp:write"],
      tokenEndpointAuthMethods: ["none"],
    });

    expect(meta.token_endpoint_auth_methods_supported).toEqual(["none"]);
  });

  it("is re-exported from the package barrel", () => {
    expect(buildFromBarrel).toBe(buildAuthorizationServerMetadata);

    const meta = buildFromBarrel({
      issuer: "https://app.example.com",
      scopesSupported: ["mcp:read", "mcp:write"],
    });
    expect(meta.code_challenge_methods_supported).toEqual(["S256"]);
  });
});
