import { describe, expect, it, vi } from "vitest";
import { assertDbMirror, assertEnvMirror, assertExportsMirror } from "@12-apps/wiring/producer";

import packageJson from "../../../package.json";
import { emailAuthRoutes } from "../../server/email-routes";
import { emailAuthSettingsRoutes } from "../../server/settings-routes";
import {
  createApiEmailAuth,
  createApiEmailAuthSettings,
} from "../../server/create-api-email-auth";
import { authManifest, authPlatformManifest } from "../index";
import { authPlatformServerManifest, authServerManifest } from "../server";
import { authPlatformWebManifest, authWebManifest } from "../web";

/**
 * The producer half, asserted against what this package actually ships.
 *
 * The inventory checks run at MODULE LOAD — `defineServerManifest` and
 * `defineWebManifest` refuse a runtime manifest that drifts from the shared
 * one — so importing the three files is already half the test. What follows
 * asserts the half a type cannot: that the names in `areas` resolve to real
 * screens, that the routes are the ones a host would otherwise mount by hand,
 * and that the email contribution really does bind a port.
 */

describe("authManifest", () => {
  it("declares the package identity and the runtime inventory", () => {
    expect(authManifest.name).toBe("@12-apps/auth");
    expect(authManifest.contract).toBe(1);
    expect(authManifest.server).toEqual(["http", "email"]);
    expect(authManifest.web).toEqual(["surface", "areas"]);
  });

  it("declares the Prisma contribution prisma:sync actually copies", () => {
    // Both halves: the partial a host syncs in, and the migrations directory
    // beside it. A partial with no migrations is a schema a host can generate
    // a client from and never create the tables for.
    expect(authManifest.db).toEqual({
      partial: "prisma/auth.prisma",
      migrations: "prisma/migrations",
    });
  });

  it("owns the tables from ONE manifest, so the platform half declares no db", () => {
    // The settings rows the operator surface writes live in the same partial.
    // Declaring `db` twice would have a host sync one schema under two names.
    expect(authPlatformManifest.db).toBeUndefined();
  });

  it("splits the platform surface into its own manifest", () => {
    // An `http` capability binds ONE mount path, and these two surfaces cannot
    // share one: different audience, different path, different gate.
    expect(authPlatformManifest.name).toBe("@12-apps/auth-platform");
    expect(authPlatformManifest.server).toEqual(["http"]);
  });

  it("declares the env surface — the exact keys build-config reads", () => {
    const names = (authManifest.env ?? []).map((declared) => declared.name);
    expect(names).toHaveLength(13);
    expect(names).toContain("AUTH_SECRET");
    // Only the signing secret is REQUIRED — every provider pair, the
    // allowlist and the toggles degrade by design when unset.
    const required = (authManifest.env ?? []).filter((declared) => declared.required);
    expect(required.map((declared) => declared.name)).toEqual(["AUTH_SECRET"]);
    // Everything that is a credential never has its value reported.
    for (const name of ["AUTH_SECRET", "GOOGLE_CLIENT_SECRET", "FACEBOOK_CLIENT_SECRET", "APPLE_CLIENT_SECRET"]) {
      expect((authManifest.env ?? []).find((declared) => declared.name === name)?.secret).toBe(true);
    }
    // The platform surface reads no env of its own.
    expect(authPlatformManifest.env).toBeUndefined();
  });

  it("mirrors db and env into package.json, and the exports map matches the declarations", () => {
    // The mirrors are what host tooling that cannot execute TypeScript reads;
    // the exports check is the #1008 tripwire — a capability shipped as a
    // subpath the manifest never mentioned, invisible to the adopting host.
    // The platform manifest is a wiring identity with no package.json of its
    // own, so only the package-named manifest is pinned here.
    expect(() => assertDbMirror(authManifest, packageJson)).not.toThrow();
    expect(() => assertEnvMirror(authManifest, packageJson)).not.toThrow();
    expect(() => assertExportsMirror(authManifest, packageJson)).not.toThrow();
  });
});

describe("authServerManifest", () => {
  it("hands hosts the existing factories, not wrappers that could drift", () => {
    expect(authServerManifest().http?.create).toBe(createApiEmailAuth);
    expect(authPlatformServerManifest.http?.create).toBe(createApiEmailAuthSettings);
  });

  it("contributes every sign-in route, and only those", () => {
    const credentials = {} as Parameters<typeof createApiEmailAuth>[0]["credentials"];
    const config = { credentials, messages: {} as never };
    const wire = createApiEmailAuth(config).routes.map((r) => `${r.method} ${r.path}`);
    const descriptors = emailAuthRoutes(config).map((r) => `${r.method} ${r.path}`);

    expect(wire).toEqual(descriptors);
  });

  it("contributes both platform verbs", () => {
    const store = { read: vi.fn(), write: vi.fn() };
    const wire = createApiEmailAuthSettings({ store }).routes.map((r) => r.method);

    expect(wire).toEqual(emailAuthSettingsRoutes({ store }).map((r) => r.method));
    expect(wire).toContain("GET");
    expect(wire).toContain("PUT");
  });

  it("binds the host's ONE delivery port into four semantic sends", async () => {
    // The whole point of the email capability: the host implements `send` once,
    // for every package that mails, and this package keeps its own sentences.
    const sent: { to: string; subject: string }[] = [];
    const mailer = authServerManifest().email?.createMailer({
      send: async (to, message) => {
        sent.push({ to, subject: message.subject });
      },
    }) as { sendVerification: (m: unknown) => Promise<void> };

    await mailer.sendVerification({
      to: "shopper@example.test",
      name: "Ana",
      link: "https://shop.example.test/verify?token=abc",
      token: "abc",
      expiresAt: new Date("2026-01-01T02:00:00.000Z"),
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("shopper@example.test");
    expect(sent[0]?.subject).toBeTruthy();
  });

  it("declares no email on the platform half — it only reads and writes rows", () => {
    // Read off the keys rather than the property: the manifest's TYPE already
    // has no `email`, which is the stronger guarantee — this asserts the value
    // agrees, so a later widening of the type cannot quietly add one.
    expect(Object.keys(authPlatformServerManifest)).toEqual(["name", "http"]);
  });
});

describe("authWebManifest", () => {
  /**
   * Every screen name any area suggests, across both manifests.
   *
   * A function rather than a describe-scoped const: shared state at that level
   * makes tests order-dependent, which the flakiness gate rejects — and here
   * it would be shared across files that never asked for it.
   */
  const suggestedScreens = (): string[] =>
    [...(authWebManifest.areas ?? []), ...(authPlatformWebManifest.areas ?? [])]
      .flatMap((area) => area.routes ?? [])
      .map((route) => route.screen);

  it("names screens that the built surface actually exposes", () => {
    // The integrity property the docs promise: a host projecting a route looks
    // the component up by this name rather than guessing. A rename here that
    // did not reach the surface would be a host-side undefined component,
    // which renders as a blank page with nothing in any log.
    const surface = authWebManifest.surface?.create({
      copy: {} as never,
      pages: {} as never,
      useSession: () => ({}) as never,
      Link: (() => null) as never,
    }) as unknown as Record<string, unknown>;

    for (const name of suggestedScreens().filter((n) => n !== "page")) {
      expect(surface[name], `${name} is suggested by an area but not on the surface`).toBeTypeOf(
        "function",
      );
    }
  });

  it("offers sign-up in the storefront but not in the backoffice", () => {
    // An operator account is granted, never self-served — so the admin area
    // suggests login and the two reset screens, and no signup.
    const areaScreens = (area: string): string[] =>
      (authWebManifest.areas ?? [])
        .filter((entry) => entry.area === area)
        .flatMap((entry) => entry.routes ?? [])
        .map((route) => route.screen);

    expect(areaScreens("storefront")).toContain("SignupPage");
    expect(areaScreens("admin")).not.toContain("SignupPage");
    expect(areaScreens("admin")).toContain("LoginPage");
  });

  it("suggests the platform console with a matching nav anchor", () => {
    // The route and the nav entry must agree on the path, or the sidebar links
    // somewhere the router does not answer.
    const [area] = authPlatformWebManifest.areas ?? [];
    expect(area?.area).toBe("super-admin");
    expect(area?.routes?.[0]?.path).toBe("auth-settings");
    expect(area?.nav?.[0]?.path).toBe("auth-settings");
    expect(area?.nav?.[0]?.testId).toBe("auth-settings");
  });
});
