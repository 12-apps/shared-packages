import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { asHarness, registerTestClient } from "./fixtures";
import { mcpOauthRouter } from "../../hono/index";
import { resolveTrustedOrigin, trustedOriginsFromEnv } from "../config";

/**
 * The mounted surface (12-23): the gate, the discovery documents, the JWKS, the
 * registration contract and the trusted-origin resolver.
 *
 * These are the parts a reviewer cannot see by reading one handler — a document
 * that advertises a path nothing serves, or an issuer a forwarded header chose,
 * are both green in isolation and broken in a deployment.
 */

const ORIGIN = "https://app.example.com";

describe("the operator gate", () => {
  it("makes every endpoint inert (404) while it is off, except registration (403)", async () => {
    const { api } = await asHarness({ enabled: false });

    for (const route of api.routes) {
      const request = new Request(`${ORIGIN}${route.path}`, {
        method: route.method,
        ...(route.method === "POST" ? { body: "{}" } : {}),
      });
      const response = await route.handle(request);
      // 404 everywhere: a probe cannot tell a disabled AS from an app that has
      // none. RFC 7591 registration is the exception — it has a code for "the
      // endpoint is here, registration is closed".
      expect(response.status).toBe(route.path.includes("register") ? 403 : 404);
    }
  });

  it("creates no client while registration is closed", async () => {
    const { api, stores } = await asHarness({ enabled: false });
    const response = await api.handlers.register(
      new Request(`${ORIGIN}/api/oauth/register`, {
        method: "POST",
        body: JSON.stringify({ redirect_uris: ["https://claude.ai/cb"] }),
      }),
    );
    expect(await response.json()).toEqual({
      error: "access_denied",
      error_description: "dynamic client registration is disabled",
    });
    expect(stores.clients.rows()).toEqual([]);
  });
});

describe("discovery documents", () => {
  it("advertises the paths the mount actually serves", async () => {
    const { api } = await asHarness({
      paths: { authorize: "/oauth/authorize", token: "/oauth/token" },
    });
    const metadata = (await (
      await api.handlers.authorizationServerMetadata(
        new Request(`${ORIGIN}/.well-known/oauth-authorization-server`),
      )
    ).json()) as Record<string, string>;

    // A document that lies about a path is a flow that fails at the first hop —
    // which is why the resolved paths, not constants, build this.
    expect(metadata.authorization_endpoint).toBe(`${ORIGIN}/oauth/authorize`);
    expect(metadata.token_endpoint).toBe(`${ORIGIN}/oauth/token`);
    expect(api.routes.map((route) => route.path)).toContain("/oauth/authorize");
  });

  it("pins OAuth 2.1: code only, S256 only", async () => {
    const { api } = await asHarness();
    const metadata = (await (
      await api.handlers.authorizationServerMetadata(new Request(`${ORIGIN}/x`))
    ).json()) as Record<string, string[]>;

    expect(metadata.response_types_supported).toEqual(["code"]);
    expect(metadata.code_challenge_methods_supported).toEqual(["S256"]);
    expect(metadata.grant_types_supported).toEqual(["authorization_code", "refresh_token"]);
  });

  it("keeps the AS and resource documents on one source of scopes and origin", async () => {
    const { api } = await asHarness({ scopes: ["mcp:read"], resourcePath: "/mcp" });
    const as = (await (
      await api.handlers.authorizationServerMetadata(new Request(`${ORIGIN}/x`))
    ).json()) as Record<string, unknown>;
    const resource = (await (
      await api.handlers.protectedResourceMetadata(new Request(`${ORIGIN}/y`))
    ).json()) as Record<string, unknown>;

    expect(as.scopes_supported).toEqual(["mcp:read"]);
    expect(resource.scopes_supported).toEqual(["mcp:read"]);
    expect(resource.resource).toBe(`${ORIGIN}/mcp`);
    expect(resource.authorization_servers).toEqual([as.issuer]);
  });
});

describe("JWKS", () => {
  it("publishes only the public half, cacheable", async () => {
    const { api } = await asHarness();
    const response = await api.handlers.jwks(new Request(`${ORIGIN}/.well-known/jwks.json`));
    const body = (await response.json()) as { keys: Record<string, unknown>[] };

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    expect(body.keys).toHaveLength(1);
    expect(body.keys[0]).toMatchObject({ kty: "EC", crv: "P-256", alg: "ES256", use: "sig" });
    // `d` is the PRIVATE component. Publishing it would hand out the signing key.
    expect(body.keys[0]?.d).toBeUndefined();
    expect(body.keys[0]?.kid).toBe("test-key-1");
  });

  it("503s rather than serving an empty key set", async () => {
    const { api } = await asHarness({ signingKey: async () => null });
    const response = await api.handlers.jwks(new Request(`${ORIGIN}/.well-known/jwks.json`));
    // An empty/partial set would let a client mistake an unprovisioned AS for one
    // with a usable key, and then blame the signature.
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "signing_key_unavailable" });
  });
});

describe("dynamic client registration", () => {
  it("returns the secret exactly once, for a confidential client only", async () => {
    const { api } = await asHarness();
    const publicClient = await registerTestClient(api);
    expect(publicClient.clientSecret).toBeUndefined();

    const confidential = await registerTestClient(api, {
      token_endpoint_auth_method: "client_secret_basic",
    });
    expect(confidential.clientSecret).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses metadata that would widen what the AS supports", async () => {
    const { api } = await asHarness({ scopes: ["mcp:read", "mcp:write"] });
    const cases: [string, Record<string, unknown>][] = [
      ["invalid_redirect_uri", { redirect_uris: [] }],
      ["invalid_redirect_uri", { redirect_uris: ["not-absolute"] }],
      ["invalid_redirect_uri", {}],
      [
        "invalid_client_metadata",
        { redirect_uris: ["https://claude.ai/cb"], token_endpoint_auth_method: "private_key_jwt" },
      ],
      [
        "invalid_client_metadata",
        { redirect_uris: ["https://claude.ai/cb"], grant_types: ["implicit"] },
      ],
      [
        "invalid_client_metadata",
        { redirect_uris: ["https://claude.ai/cb"], scope: "mcp:read admin:everything" },
      ],
    ];

    for (const [error, metadata] of cases) {
      const response = await api.handlers.register(
        new Request(`${ORIGIN}/api/oauth/register`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(metadata),
        }),
      );
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toBe(error);
    }
  });

  it("rejects a body that is not a JSON object", async () => {
    const { api } = await asHarness();
    for (const body of ["not json", "[]", '"a string"']) {
      const response = await api.handlers.register(
        new Request(`${ORIGIN}/api/oauth/register`, { method: "POST", body }),
      );
      expect(response.status).toBe(400);
    }
  });
});

describe("trusted origins", () => {
  it("honours a forwarded host only when the operator allowlisted it", () => {
    const allow = ["https://app.example.com", "https://outra.example.com"];
    const forwarded = (host: string) => (name: string) =>
      name === "x-forwarded-host" ? host : null;

    expect(resolveTrustedOrigin(forwarded("outra.example.com"), undefined, allow)).toBe(
      "https://outra.example.com",
    );
    // A spoofed header falls back to the CANONICAL (first) allowlisted origin, not
    // to the attacker's — even though the edge really did forward it.
    expect(resolveTrustedOrigin(forwarded("evil.example.com"), undefined, allow)).toBe(
      "https://app.example.com",
    );
    // Anything that is not a bare host[:port] is not even a candidate.
    expect(resolveTrustedOrigin(forwarded("https://evil.example.com/x"), undefined, allow)).toBe(
      "https://app.example.com",
    );
  });

  it("never trusts a forwarded host when no allowlist is configured", () => {
    // Fails CLOSED to the request's own origin: a spoofed header must not be able
    // to choose the issuer a token is minted for.
    expect(
      resolveTrustedOrigin(
        (name) => (name === "x-forwarded-host" ? "evil.example.com" : null),
        "http://127.0.0.1:3000",
        [],
      ),
    ).toBe("http://127.0.0.1:3000");
  });

  it("normalizes an allowlist entry EXACTLY as the regex it replaced did", () => {
    // `normalizeOrigins` stopped using `replace(/\/+$/, "")` — quadratic on a run
    // of slashes (CodeQL js/polynomial-redos) — in favour of a character walk.
    //
    // What that normalization decides is a SECURITY BOUNDARY: the canonical origin
    // is the `iss`/`aud` a token is minted with and the `aud` bearer verification
    // then expects, and it is the value a forwarded host must equal to be honored.
    // A one-character drift there either mints tokens for the wrong origin or
    // rejects valid ones. (It is NOT the redirect-URI comparison — a registered
    // `redirect_uri` is matched exactly, upstream of this, and never normalized;
    // see the authorize suite.) So "equivalent" has to mean byte-identical rather
    // than close enough: hence a table of the values a real deployment carries,
    // asserted against the old expression itself.
    const fixtures = [
      "https://app.example.com",
      "https://app.example.com/",
      "https://app.example.com//",
      "https://app.example.com///",
      "  https://app.example.com/  ",
      "https://app.example.com:3000/",
      "https://claude.ai/api/mcp/auth_callback",
      "https://claude.ai/api/mcp/auth_callback/",
      "http://localhost:4319",
      "http://127.0.0.1:4320/",
      // Embedded (not trailing) runs must survive untouched, doubled ones included.
      "https://loja.exemplo.com.br/pedidos//",
      "https://loja.exemplo.com.br//pedidos//itens",
      "https://loja.exemplo.com.br//pedidos//itens//",
      // Unicode, including the slash LOOK-ALIKES that must survive: `／` (U+FF0F)
      // and `∕` (U+2215) are not `/` and neither implementation may strip them. A
      // `charCodeAt` walk and a regex could in principle part company on multi-byte
      // input, so the property is pinned where it is documented rather than only in
      // a fuzz run that no longer exists.
      "https://loja.exemplo.com.br/pedidos／",
      "https://loja.exemplo.com.br/pedidos∕/",
      "https://ção.exemplo.com.br/",
      "https://日本.example/パス//",
      // Newlines, the one place `$` semantics could have diverged. They cannot,
      // and for a reason worth pinning: `.trim()` runs FIRST, so a trailing
      // newline never reaches either implementation, and an interior one leaves a
      // non-slash last character that both leave untouched. (`$` in a non-`m`
      // pattern anchors at end-of-input only anyway — there is no Perl-style
      // final-newline exception in JS.)
      "https://app.example.com//\n",
      "https://app.example.com/\na",
      "/",
      "//",
      "",
      "   ",
    ];
    for (const raw of fixtures) {
      const legacy = raw.trim().replace(/\/+$/, "");
      // Reached through the public resolver: with a single entry, the canonical
      // origin IS that entry, normalized. A blank one is dropped by the filter,
      // leaving no allowlist at all — so the fallback answers, exactly as before.
      expect(
        resolveTrustedOrigin(() => null, "http://fallback.invalid", [raw]),
        `entry ${JSON.stringify(raw)}`,
      ).toBe(legacy === "" ? "http://fallback.invalid" : legacy);
    }
  });

  it(
    "normalizes a slash storm linearly (CodeQL js/polynomial-redos)",
    { timeout: 5_000 },
    () => {
      // Here the pathological family IS one long run, because the pattern was
      // ANCHORED (`/\/+$/`): a non-slash tail makes the anchor fail, and the engine
      // retries from every position in the run. Measured: the old expression takes
      // ~13.6s on this input, and ~1.4s at a third of it — the 9x-per-3x signature
      // of a quadratic — well past the timeout declared above, which is pinned here
      // rather than inherited so that raising the suite default cannot quietly turn
      // this case into one that passes on the old code.
      const stormy = `https://loja.exemplo.com.br${"/".repeat(180_000)}a`;
      // Nothing to strip (the tail is not a slash), so the value passes through as
      // the canonical entry.
      expect(resolveTrustedOrigin(() => null, undefined, [stormy])).toBe(stormy);
      // With the slashes AT the end, all of them go — in one pass.
      expect(
        resolveTrustedOrigin(() => null, undefined, [
          `https://loja.exemplo.com.br${"/".repeat(180_000)}`,
        ]),
      ).toBe("https://loja.exemplo.com.br");
    },
  );

  it("reads an allowlist out of an env var without the package naming it", () => {
    // The variable name is the HOST's vocabulary — passed in, never hardcoded here
    // — which is the whole reason this helper takes an argument. Read/written
    // through a computed key so the repo's turbo env-var lint does not treat a
    // fixture name as a declared build input.
    const name = "MCP_TEST_TRUSTED_ORIGINS";
    const original = process.env[name];
    /* eslint-disable test-flakiness/no-global-state-mutation, test-flakiness/no-test-isolation --
       an environment variable IS the subject here: the helper exists so a host
       names its own variable, and the only way to prove it reads one is to set
       one. The original value is captured above and restored in the `finally`
       below, whichever way the case ends. */
    try {
      process.env[name] = " https://a.example.com/ , https://b.example.com ,, ";
      expect(trustedOriginsFromEnv(name)).toEqual([
        "https://a.example.com",
        "https://b.example.com",
      ]);
      delete process.env[name];
      expect(trustedOriginsFromEnv(name)).toEqual([]);
    } finally {
      // Restored whichever way the case ends: a leaked variable would decide a
      // later case's answer, and the failure would look like the code's.
      if (original === undefined) delete process.env[name];
      else process.env[name] = original;
    }
    /* eslint-enable test-flakiness/no-global-state-mutation, test-flakiness/no-test-isolation */
  });

  it("mints for the allowlisted origin even when the request arrived internally", async () => {
    const { api } = await asHarness({ trustedOrigins: ["https://public.example.com"] });
    const metadata = (await (
      await api.handlers.authorizationServerMetadata(
        new Request("http://10.0.0.5:3000/.well-known/oauth-authorization-server"),
      )
    ).json()) as { issuer: string };
    // Behind a proxy the server sees only its internal bind; the issuer must still
    // be the public origin, because that is what a connector will present back.
    expect(metadata.issuer).toBe("https://public.example.com");
  });
});

describe("the hono mount", () => {
  it("routes every endpoint from the origin root", async () => {
    const { api } = await asHarness();
    const app = new Hono();
    const oauth = mcpOauthRouter({
      stores: api.context.stores,
      resolveSession: () => ({ subject: "s", email: "owner@example.com" }),
      signingKey: api.context.signingKey,
    });
    app.route("/", oauth.router);

    // `.well-known` cannot live under a prefix — a connector reads it from the
    // origin — which is why the descriptors carry absolute paths.
    expect((await app.request(`${ORIGIN}/.well-known/oauth-authorization-server`)).status).toBe(200);
    expect((await app.request(`${ORIGIN}/.well-known/oauth-protected-resource`)).status).toBe(200);
    expect((await app.request(`${ORIGIN}/.well-known/jwks.json`)).status).toBe(200);
    // A GET on the token endpoint is not a route at all.
    expect((await app.request(`${ORIGIN}/api/oauth/token`)).status).toBe(404);
    expect(
      (
        await app.request(`${ORIGIN}/api/oauth/token`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: "grant_type=password",
        })
      ).status,
    ).toBe(400);
  });
});
