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
import { createApiDiscounts } from "../../server/routes";
import { discountsManifest } from "../index";
import { discountsServerManifest } from "../server";

/** Every copy key, filled with its own name — the sentences are not the subject here. */
const FULL_COPY = Object.fromEntries(
  [
    "invalidQuery",
    "notFound",
    "invalidPercent",
    "invalidAmount",
    "codeRequired",
    "categoryTargetRequired",
    "itemTargetRequired",
    "invalidDate",
    "endsBeforeStarts",
    "invalidMinSubtotal",
    "invalidUsageLimit",
    "invalidPerBuyerLimit",
    "comboScopeRequired",
    "invalidComboSlots",
    "comboTargetRequired",
    "invalidComboQuantity",
    "invalidBundlePrice",
    "invalidFreeUnits",
    "freeUnitsExceedCombo",
    "invalidMaxComboApplications",
  ].map((key) => [key, key]),
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
      "GET /discounts/:id -> discounts:read",
      "POST /discounts -> discounts:write",
      "PATCH /discounts/:id -> discounts:write",
      "DELETE /discounts/:id -> discounts:write",
    ]);
  });

  it("declares NO db capability, and mirrors that absence into package.json", () => {
    // A discount's rows relate to a host's catalog and orders, so neither db
    // mode qualifies — the host owns the schema and answers `DiscountStore`.
    // Both directions are checked: a `wiring.db` key here with no manifest
    // capability would fail just as loudly.
    expect(discountsManifest).not.toHaveProperty("db");
    expect(() => assertDbMirror(discountsManifest, packageJson)).not.toThrow();
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
