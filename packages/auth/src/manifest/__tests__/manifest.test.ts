import { describe, expect, it, vi } from "vitest";
import { PT_BR_MAIL } from "../../server/mail-templates.pt-BR";
import type { AnyWebManifest, PackageManifest } from "@12-apps/wiring";
import {
  assertDbMirror,
  assertEnvMirror,
  assertExportsMirror,
  defineManifest,
  defineServerManifest,
  defineWebManifest,
} from "@12-apps/wiring/producer";

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
 * The manifests are `as const` literals now that the contract is a type-only
 * devDependency, so a key the object does not carry is a compile error rather
 * than `undefined` — right for source, useless for the cases below whose whole
 * point is to pin an ABSENCE (`db` on the platform half, `env` on it too). The
 * aliases widen them back to the shape a host adopting the manifest actually
 * holds, which is also the shape the assertions are about.
 */
const shared: PackageManifest = authManifest;
const sharedPlatform: PackageManifest = authPlatformManifest;
const web: AnyWebManifest = authWebManifest;
const webPlatform: AnyWebManifest = authPlatformWebManifest;

/**
 * The producer half, asserted against what this package actually ships.
 *
 * The manifests are plain `satisfies`-checked values — `@12-apps/wiring` is a
 * type-only devDependency, so this package's release never waits on the
 * contract package's and no auth installer downloads it. That moves the
 * producer factories' RUNTIME assertions here: the first case below runs all
 * three, so a malformed manifest or an inventory that drifts in either
 * direction still fails in this package's own test run, before any host sees
 * it. What the remaining cases assert is the half a type cannot: that the
 * names in `areas` resolve to real screens, that the routes are the ones a
 * host would otherwise mount by hand, and that the email contribution really
 * does bind a port.
 */

describe("the producer assertions", () => {
  it("validates all six manifests — the check a type-only import cannot run", () => {
    // Identity, contribution validation and the inventory cross-check between
    // the shared manifest and each runtime half, in BOTH directions: a
    // capability cannot ship undeclared, nor stay declared after it is gone.
    // This ran at import while the factories were called at module load; it
    // runs here now, and dropping it would be the whole cost of the move.
    expect(defineManifest(authManifest)).toBe(authManifest);
    expect(defineManifest(authPlatformManifest)).toBe(authPlatformManifest);

    const server = authServerManifest({ pack: PT_BR_MAIL });
    expect(defineServerManifest(authManifest, server)).toBe(server);
    expect(defineServerManifest(authPlatformManifest, authPlatformServerManifest)).toBe(
      authPlatformServerManifest,
    );

    expect(defineWebManifest(authManifest, authWebManifest)).toBe(authWebManifest);
    expect(defineWebManifest(authPlatformManifest, authPlatformWebManifest)).toBe(
      authPlatformWebManifest,
    );
  });
});

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
    expect(shared.db).toEqual({
      partial: "prisma/auth.prisma",
      migrations: "prisma/migrations",
    });
  });

  it("owns the tables from ONE manifest, so the platform half declares no db", () => {
    // The settings rows the operator surface writes live in the same partial.
    // Declaring `db` twice would have a host sync one schema under two names.
    expect(sharedPlatform.db).toBeUndefined();
  });

  it("splits the platform surface into its own manifest", () => {
    // An `http` capability binds ONE mount path, and these two surfaces cannot
    // share one: different audience, different path, different gate.
    expect(authPlatformManifest.name).toBe("@12-apps/auth-platform");
    expect(authPlatformManifest.server).toEqual(["http"]);
  });

  it("declares the env surface — the exact keys build-config reads", () => {
    const names = (shared.env ?? []).map((declared) => declared.name);
    expect(names).toHaveLength(13);
    expect(names).toContain("AUTH_SECRET");
    // Only the signing secret is REQUIRED — every provider pair, the
    // allowlist and the toggles degrade by design when unset.
    const required = (shared.env ?? []).filter((declared) => declared.required);
    expect(required.map((declared) => declared.name)).toEqual(["AUTH_SECRET"]);
    // Everything that is a credential never has its value reported.
    for (const name of ["AUTH_SECRET", "GOOGLE_CLIENT_SECRET", "FACEBOOK_CLIENT_SECRET", "APPLE_CLIENT_SECRET"]) {
      expect((shared.env ?? []).find((declared) => declared.name === name)?.secret).toBe(true);
    }
    // The platform surface reads no env of its own.
    expect(sharedPlatform.env).toBeUndefined();
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
    expect(authServerManifest({ pack: PT_BR_MAIL }).http?.create).toBe(createApiEmailAuth);
    expect(authPlatformServerManifest.http?.create).toBe(createApiEmailAuthSettings);
  });

  it("contributes every sign-in route, and only those", () => {
    const credentials = {} as Parameters<typeof createApiEmailAuth>[0]["credentials"];
    const config = { credentials, messages: {} as never };
    const wire = createApiEmailAuth(config).routes.map((r) => `${r.method} ${r.path}`);
    const descriptors = emailAuthRoutes(config).map((r) => `${r.method} ${r.path}`);

    expect(wire).toEqual(descriptors);
  });

  it("says which routes need a caller, in the CONTRACT's vocabulary", () => {
    // Six of the eight sign-in endpoints are anonymous by definition, and
    // `kind` defaults to `authenticated` — which is what a host's gate reads.
    // Without this the whole sign-in surface answers 401 before a handler runs,
    // while the two account routes work: a package nobody can sign in to,
    // mounting cleanly. The Hono adapter never noticed because it asks
    // `route.session` itself; only the wire view has to say it.
    const credentials = {} as Parameters<typeof createApiEmailAuth>[0]["credentials"];
    const kinds = new Map(
      createApiEmailAuth({ credentials, messages: {} as never }).routes.map((route) => [
        `${route.method} ${route.path}`,
        route.kind,
      ]),
    );

    expect(kinds.get("POST /signup")).toBe("public");
    expect(kinds.get("POST /forgot-password")).toBe("public");
    expect(kinds.get("POST /reset-password")).toBe("public");
    expect([...kinds.values()].filter((kind) => kind === "authenticated")).toHaveLength(2);
  });

  it("marks BOTH platform verbs authenticated — an operator switch has a caller", () => {
    const store = { read: vi.fn(), write: vi.fn() };

    createApiEmailAuthSettings({ store }).routes.forEach((route) => {
      expect(route.kind).toBe("authenticated");
    });
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
    const mailer = authServerManifest({ pack: PT_BR_MAIL }).email?.createMailer({
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
  const suggestedScreens = (manifest: AnyWebManifest): string[] =>
    (manifest.areas ?? []).flatMap((area) => area.routes ?? []).map((route) => route.screen);

  it("names screens that the built surface actually exposes", () => {
    // The integrity property the docs promise: a host projecting a route looks
    // the component up by this name rather than guessing. A rename here that
    // did not reach the surface would be a host-side undefined component,
    // which renders as a blank page with nothing in any log.
    //
    // Each manifest is checked against ITS OWN surface. Both used to be checked
    // against the sign-in one, with `page` filtered out — and the filter was
    // the defect rather than a carve-out: the platform surface was the settings
    // component itself, so the only row it suggests resolved to `undefined`.
    const screens = authWebManifest.surface?.create({
      copy: {} as never,
      pages: {} as never,
      useSession: () => ({}) as never,
      Link: (() => null) as never,
    }) as unknown as Record<string, unknown>;

    const platform = authPlatformWebManifest.surface?.create({
      client: {} as never,
      copy: {} as never,
      formatWhen: () => "",
    }) as unknown as Record<string, unknown>;

    const cases: [AnyWebManifest, Record<string, unknown>][] = [
      [web, screens],
      [webPlatform, platform],
    ];

    for (const [manifest, surface] of cases) {
      for (const name of suggestedScreens(manifest)) {
        expect(surface[name], `${name} is suggested by an area but not on the surface`).toBeTypeOf(
          "function",
        );
      }
    }
  });

  it("offers sign-up in the client area but not in the backoffice", () => {
    // An operator account is granted, never self-served — so the admin area
    // suggests login and the two reset screens, and no signup.
    const areaScreens = (area: string): string[] =>
      (web.areas ?? [])
        .filter((entry) => entry.area === area)
        .flatMap((entry) => entry.routes ?? [])
        .map((route) => route.screen);

    // `client` is the shopper-facing area id the wiring contract itself
    // documents; `storefront` was one host's name for it, and matched nothing
    // in a host projecting areas by the contract's ids.
    expect(areaScreens("client")).toContain("SignupPage");
    expect(areaScreens("admin")).not.toContain("SignupPage");
    expect(areaScreens("admin")).toContain("LoginPage");
  });

  it("suggests the platform console with a matching nav anchor", () => {
    // The route and the nav entry must agree on the path, or the sidebar links
    // somewhere the router does not answer.
    const [area] = webPlatform.areas ?? [];
    expect(area?.area).toBe("super-admin");
    expect(area?.routes?.[0]?.path).toBe("auth-settings");
    expect(area?.nav?.[0]?.path).toBe("auth-settings");
    expect(area?.nav?.[0]?.testId).toBe("auth-settings");
  });
});
