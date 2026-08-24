/**
 * `@12-apps/payments-frontend`'s wiring compliance, asserted HERE rather than
 * in its own suite — the `payments-manifest.test.ts` move, for the same
 * reason: the payments portability ruleset (`payments/no-host-imports`)
 * allows the package no `@12-apps/wiring` import at all, type-only included,
 * because it must vendor into a repo with no wiring contract. Its manifests
 * stay untyped pure data over there, and this file gives them the same
 * "fails in a test run before any host sees it" guarantee.
 *
 * The two manifests are the browser twins of the backend's privilege split:
 * the OWNER's settings screen and the SHOPPER's checkout, which mount in
 * different applications behind different gates. The split is asserted, not
 * assumed — a merged manifest would be the regression this file exists to
 * catch.
 */

import { describe, expect, it } from "vitest";

import {
  paymentsCheckoutFrontendManifest,
  paymentsFrontendManifest,
} from "@12-apps/payments-frontend/manifest";
import {
  paymentsCheckoutFrontendWebManifest,
  paymentsFrontendWebManifest,
} from "@12-apps/payments-frontend/manifest/web";
import paymentsFrontendPackageJson from "@12-apps/payments-frontend/package.json";
import type { AnyWebManifest, PackageManifest } from "../contract/manifest";
import {
  assertDbMirror,
  assertEnvMirror,
  assertExportsMirror,
  defineManifest,
  defineWebManifest,
} from "../producer";

const settings: PackageManifest = paymentsFrontendManifest;
const checkout: PackageManifest = paymentsCheckoutFrontendManifest;

/** Read afresh per test — the flakiness lane refuses shared test-scope bindings. */
function settingsWeb(): AnyWebManifest {
  return paymentsFrontendWebManifest as AnyWebManifest;
}

function checkoutWeb(): AnyWebManifest {
  return paymentsCheckoutFrontendWebManifest as AnyWebManifest;
}

describe("the payments-frontend manifests, through wiring's own producer", () => {
  it("passes the producer assertions, both identities, web halves included", () => {
    expect(defineManifest(settings)).toBe(settings);
    expect(defineManifest(checkout)).toBe(checkout);
    expect(defineWebManifest(settings, settingsWeb())).toBe(paymentsFrontendWebManifest);
    expect(defineWebManifest(checkout, checkoutWeb())).toBe(paymentsCheckoutFrontendWebManifest);
  });

  it("declares the owner's screen: a surface, an admin area, and the payments namespace", () => {
    expect(settings.name).toBe("@12-apps/payments-frontend");
    expect(settings.contract).toBe(1);
    expect(settings.web).toEqual(["surface", "areas"]);
    expect(settings.observability).toEqual({ namespace: "payments" });
  });

  it("keeps the privilege split as two manifests — the buyer surface is its own identity", () => {
    expect(checkout.name).toBe("@12-apps/payments-checkout-ui");
    expect(checkout.web).toEqual(["surface", "areas"]);
    // A failed checkout is ONE incident across the two halves, so the browser
    // side files under the backend buyer surface's namespace.
    expect(checkout.observability).toEqual({ namespace: "payments-checkout" });
    expect(settings.name).not.toBe(checkout.name);
  });

  it("declares no server half and none of the backend's capabilities", () => {
    for (const manifest of [settings, checkout]) {
      // The HTTP surfaces, the sweeps and the schema are payments-backend's.
      expect(manifest.server).toBeUndefined();
      expect(manifest.db).toBeUndefined();
      expect(manifest.mcp).toBeUndefined();
      expect(manifest.permissions).toBeUndefined();
      expect(manifest.env).toBeUndefined();
      // The journeys ship in the SIBLING @12-apps/payments-e2e.
      expect(manifest.e2e).toBeUndefined();
    }
  });

  it("routes the settings page into admin with a nav row, and no gates", () => {
    expect(settingsWeb().areas).toEqual([
      {
        area: "admin",
        routes: [{ path: "config/payments", screen: "page" }],
        nav: [{ testId: "payments", path: "config/payments" }],
      },
    ]);
  });

  it("routes the checkout into client with NO nav row — a checkout is reached from a cart", () => {
    expect(checkoutWeb().areas).toEqual([
      { area: "client", routes: [{ path: "checkout", screen: "Checkout" }] },
    ]);
    const [area] = checkoutWeb().areas ?? [];
    expect(area?.nav).toBeUndefined();
  });

  it("names a screen the bound surface actually has", () => {
    // The area rows reference screens BY KEY, so a renamed export would leave
    // a route pointing at nothing — a blank page, discovered by whoever was
    // trying to use it. Built through the CONCRETE manifest rather than the
    // widened `AnyWebManifest` view, whose `create` takes `never` by design.
    const surface = paymentsFrontendWebManifest.surface.create({ client: {} as never });
    expect(Object.keys(surface)).toContain("page");
    const [area] = settingsWeb().areas ?? [];
    expect(area?.routes?.map((route) => route.screen)).toEqual(["page"]);
  });

  it("routes the checkout at the one-line mount createPaymentFlows returns", () => {
    // Not built here: `createPaymentFlows` needs a host's cart, scope, ports
    // and copy pack, and none of that is this suite's to invent. What an area
    // row depends on is the KEY, and `PaymentFlows.Checkout` is the mount the
    // package documents as "a complete buyer checkout in one line".
    const [area] = checkoutWeb().areas ?? [];
    expect(area?.routes?.map((route) => route.screen)).toEqual(["Checkout"]);
    expect(typeof paymentsCheckoutFrontendWebManifest.surface.create).toBe("function");
  });

  it("mirrors the (absent) db declaration and the manifest subpaths into package.json", () => {
    expect(() => assertDbMirror(settings, paymentsFrontendPackageJson)).not.toThrow();
    expect(() => assertEnvMirror(settings, paymentsFrontendPackageJson)).not.toThrow();
    expect(() => assertExportsMirror(settings, paymentsFrontendPackageJson)).not.toThrow();
  });
});
