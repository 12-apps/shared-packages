/**
 * The wiring-compliance suite. The producer factories ASSERT — this package
 * keeps `@12-apps/wiring` as a type-only devDependency, so the runtime
 * validation runs here, in the package's own test run, rather than costing
 * every adopter a dependency.
 *
 * What the cases pin beyond that: identity, the inventory, that the
 * contributions ARE the existing exports rather than parallel restatements
 * that could drift, and the two capabilities this package deliberately does
 * not declare.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import type { WirePermissionsContribution } from "@12-apps/wiring";
import {
  assertDbMirror,
  assertEnvMirror,
  assertExportsMirror,
  defineManifest,
  defineServerManifest,
} from "@12-apps/wiring/producer";

import packageJson from "../../../package.json";
import { DISCOUNTS_PERMISSIONS } from "../../server/contribution";
import { DISCOUNTS_MCP_TOOLS } from "../../server/mcp";
import { recordingLogger } from "../../server/__tests__/recording-logger";
import { PT_BR_DISCOUNTS_SERVER_COPY } from "../../server/pt-BR";
import { createApiDiscounts } from "../../server/routes";
import { discountsManifest } from "../index";
import { discountsServerManifest } from "../server";
import { discountsWebManifest } from "../web";
import { PT_BR_DISCOUNTS_WEB_COPY } from "../../react/pt-BR";

/** Every copy key, filled with its own name — the sentences are not the subject here. */
/**
 * Every server-copy key, each mapped to its own name so a failure names the
 * sentence that is missing.
 *
 * DERIVED from the pt-BR pack rather than listed. It used to be a literal array
 * of 21 strings, which is the hand-kept list this repo keeps deleting: adding
 * `invalidSchedule` (FUT-996) to the contract turned this file red in three
 * places at once, and the fix a hurried reader reaches for is to paste one more
 * string. A pack is complete BY TYPE — `DiscountsServerCopy` is a closed record
 * — so deriving the fixture from one makes it impossible for this to fall
 * behind the contract again.
 */
const FULL_COPY = Object.fromEntries(
  Object.keys(PT_BR_DISCOUNTS_SERVER_COPY).map((key) => [key, key]),
) as never;

describe("the shared manifest", () => {
  it("passes the producer assertions — the contract is a devDependency, so the check lives here", () => {
    expect(defineManifest(discountsManifest)).toBe(discountsManifest);
    expect(defineServerManifest(discountsManifest, discountsServerManifest)).toBe(
      discountsServerManifest,
    );
  });

  it("declares the package identity and the runtime inventory", () => {
    expect(discountsManifest.name).toBe("@12-apps/discounts");
    expect(discountsManifest.contract).toBe(1);
    expect(discountsManifest.server).toEqual(["http"]);
  });

  it("contributes the SAME permission object composePermissions consumers use", () => {
    // Identity, not equality: a copy could drift from the /server export.
    expect(discountsManifest.permissions).toBe(DISCOUNTS_PERMISSIONS);
    const contribution: WirePermissionsContribution = DISCOUNTS_PERMISSIONS;
    expect(contribution.ids).toEqual(["discounts:read", "discounts:write"]);
  });

  it("advertises one tool per route descriptor, at the descriptor's own URL", () => {
    // The parity that lets a host validate a request against the schema its
    // advertised tool carries: look a tool up by its route's method+path and
    // it cannot miss. `{param}` here, `:param` there — one grammar per side.
    const { routes } = createApiDiscounts({ store: {} as never, copy: FULL_COPY, logger: recordingLogger() });
    const openApi = (wirePath: string) =>
      wirePath
        .split("/")
        .map((segment) => (segment.startsWith(":") ? `{${segment.slice(1)}}` : segment))
        .join("/");
    expect(new Set(DISCOUNTS_MCP_TOOLS.map((tool) => `${tool.method} ${tool.path}`))).toEqual(
      new Set(routes.map((route) => `${route.method} ${openApi(route.path)}`)),
    );
  });

  it("declares each route's permission, so a host's gates read a table not a file", () => {
    const { routes } = createApiDiscounts({ store: {} as never, copy: FULL_COPY, logger: recordingLogger() });
    expect(
      routes.map((route) => `${route.method} ${route.path} -> ${route.permission}`),
    ).toEqual([
      "GET /discounts -> discounts:read",
      // Before the `:id` read on purpose: a router resolving in declaration
      // order would otherwise answer `/discounts/targets` with a 404 for a
      // discount named "targets".
      "GET /discounts/targets -> discounts:write",
      "GET /discounts/:id -> discounts:read",
      "POST /discounts -> discounts:write",
      "PATCH /discounts/:id -> discounts:write",
      "DELETE /discounts/:id -> discounts:write",
    ]);
  });

  it("ships its schema as a COMPOSED partial, mirrored into package.json", () => {
    // Both directions are checked by `assertDbMirror`: a `wiring.db` key in the
    // manifest that package.json does not mirror is invisible to a host's
    // plain-Node assembler, and a mirror with no capability is a copy nothing
    // declared.
    expect(discountsManifest.db).toEqual({
      partial: "prisma/discounts.prisma",
      migrations: "prisma/migrations",
    });
    expect(() => assertDbMirror(discountsManifest, packageJson)).not.toThrow();
  });

  it("ships the partial and the migrations in the TARBALL, not just in the repo", () => {
    // The mirror above says where they are; `files` is what decides whether a
    // consumer installing this package can actually reach them. A composed
    // contribution whose partial is not published is a host sync that fails at
    // `pnpm install`, on a path that exists in the monorepo.
    expect(packageJson.files).toContain("prisma");
    expect(packageJson.files).toContain("scripts");
  });

  it("names NO host table anywhere in the partial", () => {
    // The property that makes the partial shippable at all, asserted over the
    // shipped FILE rather than over the docstring that claims it: a `@relation`
    // to a table this package cannot know is exactly the thing that used to
    // make `db` undeclarable, and it would come back as an ordinary-looking
    // convenience.
    /* eslint-disable-next-line test-flakiness/no-unmocked-fs --
       the SHIPPED partial is the subject: a mocked read would assert against a
       fixture, and pass forever while the published file said whatever it
       liked. This is the app-shell portability suite's own argument. */
    const partial = readFileSync(
      new URL("../../../prisma/discounts.prisma", import.meta.url),
      "utf8",
    );
    // Comment-stripped, the way the repo's copy-portability gate reads source:
    // the header EXPLAINS which host tables are deliberately absent, and a
    // scan that could not tell prose from schema would forbid saying so.
    const schema = partial
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n");
    const relations = schema.match(/@relation\(/g) ?? [];
    // The only relations are the three INTERNAL ones, between this package's
    // own three models.
    expect(relations).toHaveLength(3);
    for (const table of ["product_categories", "menu_items", "clients", "orders"]) {
      expect(schema).not.toContain(table);
    }
  });

  it("reads nothing from the environment, and mirrors that absence too", () => {
    // The advertised list-query schema is built from the search config's
    // DEFAULTS on purpose: reading process.env at module scope would make the
    // generated tool surface depend on where it was generated.
    expect(discountsManifest).not.toHaveProperty("env");
    expect(() => assertEnvMirror(discountsManifest, packageJson)).not.toThrow();
  });

  it("keeps exports subpaths and manifest declarations the same set", () => {
    // A capability shipped as an exports subpath the manifest never mentions
    // is invisible to the adopting host; the reverse is a declaration whose
    // subpath does not resolve.
    expect(() => assertExportsMirror(discountsManifest, packageJson)).not.toThrow();
  });

  it("declares the WEB half, and ships a subpath for each contribution", () => {
    // The capability list and the exports map are two statements of one fact,
    // and `assertExportsMirror` below already pins them against each other —
    // this names what they should say, so a capability quietly dropped from
    // the manifest fails as a missing declaration rather than as a mirror that
    // agrees about nothing.
    expect(discountsManifest.web).toEqual(["surface", "areas"]);
    expect(Object.keys(packageJson.exports)).toEqual(
      expect.arrayContaining(["./react", "./react/pt-BR", "./manifest/web"]),
    );
  });

  it("suggests a route and a nav row, and gates BOTH on the read permission", () => {
    // Suggestions, structurally: a host composes, reorders, relabels and vetoes
    // at its single call site. What it must not have to re-derive is which
    // permission the surface needs — that is the package's own contribution,
    // and a nav row visible to somebody the route refuses is a dead link.
    const [area] = discountsWebManifest.areas;
    expect(area?.area).toBe("admin");
    expect(area?.routes[0]).toMatchObject({ path: "discounts", screen: "Screen" });
    expect(area?.routes[0]?.permission).toBe("discounts:read");
    expect(area?.nav[0]?.permission).toBe(area?.routes[0]?.permission);
    expect(area?.nav[0]?.path).toBe(area?.routes[0]?.path);
  });

  it("names a screen the surface actually builds", () => {
    // An `AreaRouteDeclaration` references a surface member BY KEY, so a typo
    // is a host rendering `undefined` at a route that looks wired.
    const surface = discountsWebManifest.surface.create({
      apiBase: "/api",
      copy: PT_BR_DISCOUNTS_WEB_COPY,
      locale: "pt-BR",
      currency: "BRL",
      currencyField: () => null as never,
      onError: () => {},
      transport: {
        get: () => Promise.reject(new Error("unused")),
        send: () => Promise.reject(new Error("unused")),
      },
    });
    const screen = discountsWebManifest.areas[0]?.routes[0]?.screen ?? "";
    expect(surface).toHaveProperty(screen);
  });

  it("files its telemetry under its own namespace", () => {
    expect(discountsManifest.observability).toEqual({ namespace: "discounts" });
  });

  it("HONOURS that declaration — the surface cannot be built without a logger", () => {
    // The case that would have caught the original gap. Declaring the
    // namespace made the binder build a logger and hang it on
    // `assembled.loggers`; nothing then took it, and the package held no log
    // call at all, so the declaration was true of the binder and false of the
    // code. A declaration nothing consumes is worse than none: it reads as a
    // finished observability story.
    expect(() =>
      createApiDiscounts({ store: {} as never, copy: FULL_COPY, logger: undefined as never }),
    ).toThrow(/observability namespace/);
  });
});
