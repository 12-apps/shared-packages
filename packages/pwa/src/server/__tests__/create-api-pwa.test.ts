/* eslint-disable test-flakiness/no-test-isolation -- `app` is a local const from
   `mounted()`, a new Hono app per case; the rule matches the identifier across the
   file rather than its scope. */
// @vitest-environment node
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { pwaRouter } from "../../hono/index";
import { createApiPwa } from "../create-api-pwa";
import { buildWebAppManifest, shortNameFor, type PwaApp } from "../manifest";
import { pwaServiceWorkerSource } from "../service-worker-source";

/**
 * The manifest ENDPOINT and the packaged worker (12-23) — the port of
 * future-pay's `storefront-manifest` route behaviour into the package.
 *
 * The cases here are the ones that were only ever true by accident in a host:
 * that "not an app" is an empty 404 rather than a partial manifest, that the
 * body is the W3C shape at the TOP LEVEL (not the house `{ data }` envelope, a
 * wrapper the browser cannot read), and that the generated worker is
 * network-first for documents — the rule whose inversion makes a blank page
 * permanent on an installed app.
 */

const STORE: PwaApp = {
  id: "/minha-loja/",
  name: "Minha Loja de Bebidas",
  startUrl: "/menu",
  themeColor: "#112233",
  icons: [{ src: "/icons/192.png?v=3", sizes: "192x192", type: "image/png", purpose: "any maskable" }],
};

function mounted(resolveApp: (host: string) => PwaApp | null): Hono {
  const app = new Hono();
  const pwa = pwaRouter({
    resolveApp: ({ host }) => resolveApp(host),
    serviceWorker: { cachePrefix: "storefront", cacheVersion: "v2" },
  });
  app.route("/", pwa.router);
  return app;
}

describe("buildWebAppManifest", () => {
  it("keeps the app id stable and separate from the display name", () => {
    // A changed `id` is a DIFFERENT app to the browser: anyone who installed the
    // old one ends up with two icons, so a rename must not touch it.
    const manifest = buildWebAppManifest({ ...STORE, name: "Outro Nome" });
    expect(manifest.id).toBe("/minha-loja/");
    expect(manifest.name).toBe("Outro Nome");
  });

  it("elides a long name for the home screen and leaves a short one alone", () => {
    expect(buildWebAppManifest(STORE).short_name).toBe("Minha Loja…");
    expect(shortNameFor("Bar do Zé")).toBe("Bar do Zé");
  });

  it("defaults the splash colour away from the theme colour", () => {
    // The background sits behind the icon while the app boots; a saturated brand
    // colour there reads as a flash rather than as a background.
    const manifest = buildWebAppManifest(STORE);
    expect(manifest.theme_color).toBe("#112233");
    expect(manifest.background_color).toBe("#FFFFFF");
  });

  it("accepts an empty icon list as a legitimate manifest", () => {
    // Honest: the store is not installable yet. Pointing at the platform's own
    // icon would put OUR mark on a white-labelled home screen.
    expect(buildWebAppManifest({ ...STORE, icons: undefined }).icons).toEqual([]);
  });

  it("lets a host add manifest fields the package does not model", () => {
    const manifest = buildWebAppManifest({ ...STORE, extra: { lang: "pt-BR" } });
    expect(manifest.lang).toBe("pt-BR");
  });
});

describe("the manifest endpoint", () => {
  it("answers the W3C shape at the top level, not an envelope", async () => {
    const app = mounted(() => STORE);
    const response = await app.request("http://loja.exemplo.com.br/manifest.webmanifest");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/manifest+json");
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.start_url).toBe("/menu");
    expect(body.data).toBeUndefined();
  });

  it("404s with an EMPTY body where the host says this is not an app", async () => {
    // The 404 IS the gate: installability exists exactly where the host's own
    // domain rules say it does, with no extra feature flag to keep in sync.
    const app = mounted((host) => (host === "loja.exemplo.com.br" ? STORE : null));
    const response = await app.request("http://plataforma.exemplo.com/manifest.webmanifest");

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("404s the WORKER too where the host is not an app", async () => {
    // Both routes or the claim is only about the manifest. The worker source is
    // byte-identical for every tenant, so a 200 here never leaked anything — but a
    // served worker under a 404 manifest reads to an adopter as "the worker is
    // public", and `resolveApp` is meant to be the one gate.
    const app = mounted((host) => (host === "loja.exemplo.com.br" ? STORE : null));

    const refused = await app.request("http://plataforma.exemplo.com/sw.js");
    expect(refused.status).toBe(404);
    expect(await refused.text()).toBe("");

    // …and it is still served where the host IS an app.
    const served = await app.request("http://loja.exemplo.com.br/sw.js");
    expect(served.status).toBe(200);
    expect(served.headers.get("service-worker-allowed")).toBe("/");
  });

  it("resolves the app per HOST, so two origins are two apps", async () => {
    const app = mounted((host) =>
      host === "a.exemplo.com" ? STORE : { ...STORE, id: "/outra/", name: "Outra Loja" },
    );
    const first = (await (
      await app.request("http://a.exemplo.com/manifest.webmanifest")
    ).json()) as { id: string };
    const second = (await (
      await app.request("http://b.exemplo.com/manifest.webmanifest")
    ).json()) as { id: string };

    expect(first.id).toBe("/minha-loja/");
    expect(second.id).toBe("/outra/");
  });

  it("prefers the forwarded host, because a per-tenant domain sits behind a proxy", async () => {
    const seen: string[] = [];
    const app = new Hono();
    app.route(
      "/",
      pwaRouter({
        resolveApp: ({ host }) => {
          seen.push(host);
          return null;
        },
      }).router,
    );
    await app.request("http://internal:3000/manifest.webmanifest", {
      headers: { "x-forwarded-host": "Loja.Exemplo.com.br, edge.internal" },
    });
    // Lowercased, first hop only — and whether to TRUST it stays the host's
    // decision inside resolveApp.
    expect(seen).toEqual(["loja.exemplo.com.br"]);
  });

  it("caches for five minutes, revalidated", async () => {
    const app = mounted(() => STORE);
    const response = await app.request("http://loja.exemplo.com.br/manifest.webmanifest");
    expect(response.headers.get("cache-control")).toBe("public, max-age=300, must-revalidate");
  });

  it("puts the forwarded host in the cache key, so one tenant never gets another's", async () => {
    const app = mounted(() => STORE);
    const response = await app.request("http://loja.exemplo.com.br/manifest.webmanifest", {
      headers: { "x-forwarded-host": "loja.exemplo.com.br" },
    });
    // Without this, a cache keyed on the path alone answers tenant B with tenant
    // A's name and icon — and that gets INSTALLED on a home screen, which outlives
    // any cache entry. A browser reproduces it in one page: two fetches of the
    // same path with different forwarded hosts, the second answered from the first
    // with no request leaving the tab.
    expect(response.headers.get("vary")).toBe("x-forwarded-host");
  });

  it("serves the manifest wherever the host mounts it", () => {
    const api = createApiPwa({ resolveApp: () => STORE, manifestPath: "/api/storefront-manifest" });
    expect(api.routes.map((route) => route.path)).toEqual(["/api/storefront-manifest"]);
  });
});

describe("the packaged service worker", () => {
  it("is served from the root with Service-Worker-Allowed", async () => {
    const app = mounted(() => STORE);
    const response = await app.request("http://loja.exemplo.com.br/sw.js");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/javascript");
    expect(response.headers.get("service-worker-allowed")).toBe("/");
    // Never cached hard: the worker is how a bad worker gets replaced.
    expect(response.headers.get("cache-control")).toBe("no-cache");
  });

  it("is absent unless the host asks for it", () => {
    const api = createApiPwa({ resolveApp: () => STORE, serviceWorker: false });
    expect(api.routes).toHaveLength(1);
    expect(api.serviceWorkerSource).toBeNull();
  });

  it("is network-first for documents and cache-first only for hashed assets", () => {
    const source = pwaServiceWorkerSource({ cachePrefix: "storefront" });
    // The rule the whole file exists for: a cache-first document pins an old
    // shell naming chunks the server no longer has, and the escape reload then
    // runs against the cache — a permanently blank installed app.
    expect(source).toContain("documentNetworkFirst");
    const documentBranch = source.slice(source.indexOf("async function documentNetworkFirst"));
    expect(documentBranch.indexOf("await fetch(request)")).toBeLessThan(
      documentBranch.indexOf("caches.match(SHELL_URL)"),
    );
    expect(source).toContain("assetFirst");
  });

  it("never stores an HTML answer under an asset URL", () => {
    // The history fallback answers a vanished chunk with 200 text/html; storing
    // THAT makes the blank page permanent on the device rather than momentary.
    expect(pwaServiceWorkerSource()).toContain("!contentType.includes('text/html')");
  });

  it("never caches the live paths, and never a non-GET", () => {
    const source = pwaServiceWorkerSource({ neverCachePrefixes: ["/api/", "/graphql"] });
    expect(source).toContain('["/api/","/graphql"]');
    expect(source).toContain("request.method !== 'GET'");
  });

  it("sweeps only its own cache prefix on activate", () => {
    // Another app on this origin owns its own prefix, and a host layer's cache
    // (a push icon that must survive a deploy) is not ours to delete.
    const source = pwaServiceWorkerSource({ cachePrefix: "storefront", cacheVersion: "v9" });
    expect(source).toContain('const CACHE_PREFIX = "storefront-"');
    expect(source).toContain('"storefront-shell-v9"');
    expect(source).toContain("key.startsWith(CACHE_PREFIX) && !OUR_CACHES.includes(key)");
  });

  it("refuses to import anything that is not a same-origin absolute path", () => {
    // A worker may only load scripts from its own origin, and a config value must
    // not be able to smuggle a third-party script into the worker scope.
    for (const bad of ["https://cdn.example.com/x.js", "//cdn.example.com/x.js", "x.js"]) {
      expect(() => pwaServiceWorkerSource({ importScripts: [bad] })).toThrow(/same-origin/);
    }
    expect(pwaServiceWorkerSource({ importScripts: ["/observability-sw.js"] })).toContain(
      'importScripts("/observability-sw.js");',
    );
  });
});
