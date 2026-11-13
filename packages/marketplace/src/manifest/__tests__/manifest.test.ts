import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import {
  assertDbMirror,
  assertEnvMirror,
  assertExportsMirror,
  defineManifest,
  defineServerManifest,
} from "@12-apps/wiring/producer";
import { createWiringHost } from "@12-apps/wiring/consumer";

import packageJson from "../../../package.json";
import { TENANT, createHarness } from "../../__tests__/harness";
import {
  createApiMarketplace,
  decideMarketplaceOrdersBody,
  MARKETPLACE_MCP_TOOLS,
  MARKETPLACE_PERMISSIONS,
  upsertMarketplaceIntegrationsBody,
  upsertMarketplaceMenuLinksBody,
} from "../../server";
import { MARKETPLACE_JOBS } from "../../server/jobs";
import { MARKETPLACE_SERVER_COPY_EN_US } from "../../server/en-US";
import { marketplaceManifest } from "..";
import { marketplaceServerManifest } from "../server";

/**
 * The wiring-compliance suite: the producer's assertions (the contract is a
 * type-only dependency, so they run here), the mirrors, tool↔route parity, the
 * decision tool's schema, the job blueprints, and an adoption by a real
 * wiring host.
 */

const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };

function apiOver(h = createHarness()) {
  return createApiMarketplace({
    engine: h.engine,
    copy: MARKETPLACE_SERVER_COPY_EN_US,
    tenantBySlug: async () => TENANT,
    logger: silent,
  });
}

describe("the manifests", () => {
  it("pass the producer assertions", () => {
    expect(defineManifest(marketplaceManifest)).toBe(marketplaceManifest);
    expect(defineServerManifest(marketplaceManifest, marketplaceServerManifest)).toBe(marketplaceServerManifest);
  });

  it("declare the identity, the inventory and the namespace", () => {
    expect(marketplaceManifest).toMatchObject({
      name: "@12-apps/marketplace",
      contract: 1,
      server: ["http", "jobs"],
      observability: { namespace: "marketplace" },
    });
  });

  it("contribute the SAME permission object the server exports, with the new named privileges", () => {
    expect(marketplaceManifest.permissions).toBe(MARKETPLACE_PERMISSIONS);
    expect(MARKETPLACE_PERMISSIONS.ids).toEqual(["marketplace:manage", "marketplace:decide"]);
  });

  it("mirror the db capability, the env absence and the exports map into package.json", () => {
    expect(() => assertDbMirror(marketplaceManifest, packageJson)).not.toThrow();
    expect(() => assertEnvMirror(marketplaceManifest, packageJson)).not.toThrow();
    expect(() => assertExportsMirror(marketplaceManifest, packageJson)).not.toThrow();
    expect(packageJson.files).toContain("prisma");
  });

  it("ship each adapter at its own subpath, beside the engine", () => {
    expect(Object.keys(packageJson.exports)).toEqual(
      expect.arrayContaining([".", "./ifood", "./ifood/pt-BR", "./ifood/en-US", "./server", "./hono"]),
    );
  });

  it("name NO host table in the partial, and give the provider no closed list", () => {
    /* eslint-disable-next-line test-flakiness/no-unmocked-fs --
       the SHIPPED partial is the subject: a mocked read would assert against
       a fixture and pass forever while the published file said anything. */
    const partial = readFileSync(new URL("../../../prisma/marketplace.prisma", import.meta.url), "utf8");
    const schema = partial
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n");
    expect(schema).not.toMatch(/@relation\(/);
    for (const table of ["clients", "orders", "menu_items"]) expect(schema).not.toContain(`"${table}"`);
  });

  it("advertise one tool per authenticated route, at the route's own URL", () => {
    const openApi = (wirePath: string) =>
      wirePath
        .split("/")
        .map((segment) => (segment.startsWith(":") ? `{${segment.slice(1)}}` : segment))
        .join("/");
    const routes = apiOver().routes.filter((route) => route.kind !== "webhook");
    expect(new Set(MARKETPLACE_MCP_TOOLS.map((tool) => `${tool.method} ${tool.path}`))).toEqual(
      new Set(routes.map((route) => `${route.method} ${openApi(route.path)}`)),
    );
    expect(MARKETPLACE_MCP_TOOLS.map((tool) => tool.operationId)).toEqual([
      "listMarketplaceIntegrations",
      "upsertMarketplaceIntegrations",
      "listMarketplaceMenuLinks",
      "upsertMarketplaceMenuLinks",
      "listMarketplaceAcceptances",
      "decideMarketplaceOrders",
    ]);
  });
});

describe("the bulk tools' schemas", () => {
  const decide = (decisions: unknown, extra: Record<string, unknown> = {}) =>
    decideMarketplaceOrdersBody.safeParse({ decisions, ...extra });

  it("take a list of accepts and refusals, with admission, preparation time, codes and offending SKUs", () => {
    const parsed = decide(
      [
        { orderId: "a", decision: "ACCEPT", admission: { admitStockPastZero: true }, preparationMinutes: 20 },
        { orderId: "b", decision: "REJECT", reasonCode: " 503 ", offendingSkus: ["X"] },
        { orderId: "c", decision: "REJECT" },
      ],
      { validateOnly: true },
    );
    expect(parsed.success).toBe(true);
    expect(parsed.data?.decisions[1]).toEqual({ orderId: "b", decision: "REJECT", reasonCode: "503", offendingSkus: ["X"] });
  });

  it("refuse a code on an accept, an unknown key at any depth, a blank code, an empty list and an unknown decision", () => {
    for (const decisions of [
      [{ orderId: "a", decision: "ACCEPT", reasonCode: "503" }],
      [{ orderId: "a", decision: "REJECT", note: "x" }],
      [{ orderId: "a", decision: "ACCEPT", admission: { maybe: true } }],
      [{ orderId: "a", decision: "REJECT", reasonCode: "  " }],
      [{ orderId: "a", decision: "REJECT", offendingSkus: [] }],
      [{ orderId: "a", decision: "MAYBE" }],
      [],
    ]) {
      expect(decide(decisions).success).toBe(false);
    }
    expect(decideMarketplaceOrdersBody.safeParse({ decisions: [{ orderId: "a", decision: "ACCEPT" }], extra: 1 }).success).toBe(false);
  });

  it("refuse the same key twice in one call, at the repeated row's path", () => {
    const decisions = decide([
      { orderId: "a", decision: "ACCEPT" },
      { orderId: "a", decision: "REJECT" },
    ]);
    const links = upsertMarketplaceMenuLinksBody.safeParse({
      links: [
        { provider: "IFOOD", externalSku: "S", menuItemId: null },
        { provider: "IFOOD", externalSku: "S", menuItemId: "m" },
      ],
    });
    const integrations = upsertMarketplaceIntegrationsBody.safeParse({
      integrations: [
        { provider: "IFOOD", enabled: true },
        { operation: "archive", provider: "IFOOD" },
      ],
    });
    expect(decisions.error?.issues[0]?.path).toEqual(["decisions", 1, "orderId"]);
    expect(links.error?.issues[0]?.path).toEqual(["links", 1, "externalSku"]);
    expect(integrations.error?.issues[0]?.path).toEqual(["integrations", 1, "provider"]);
  });

  it("take archive and unarchive as operations of the connection tool, never a settings field beside them", () => {
    expect(upsertMarketplaceIntegrationsBody.safeParse({ integrations: [{ operation: "archive", provider: "IFOOD", reason: "x" }] }).success).toBe(true);
    expect(upsertMarketplaceIntegrationsBody.safeParse({ integrations: [{ operation: "archive", provider: "IFOOD", enabled: true }] }).success).toBe(false);
    expect(upsertMarketplaceIntegrationsBody.safeParse({ integrations: [{ operation: "delete", provider: "IFOOD" }] }).success).toBe(false);
  });

  it("describe every tool in English with no keyword lists", () => {
    for (const tool of MARKETPLACE_MCP_TOOLS) {
      expect(tool.summary).not.toMatch(/[\u00C0-\u00FF]/u);
      expect(tool.summary).toMatch(/one or many|one call|all-or-nothing|List/u);
    }
  });
});

describe("the job blueprints", () => {
  it("bind under the marketplace namespace with the engine's own cadence", () => {
    expect(MARKETPLACE_JOBS.namespace).toBe("marketplace");
    const { "expire-acceptances": expire, "reconcile-inbox": reconcile, outbound } = MARKETPLACE_JOBS.blueprints;
    expect(expire.schedule?.pattern).toBe("* * * * *");
    expect(reconcile.schedule?.pattern).toBe("*/5 * * * *");
    expect(outbound).toMatchObject({ attempts: 3, backoff: { type: "exponential" } });
    expect(outbound.schedule).toBeUndefined();
  });

  it("are adopted by a wiring host, bound to the engine, and the outbound one rethrows a retry", async () => {
    const h = createHarness({
      http: {
        requests: [],
        http: async () => ({ status: 503, body: "down" }),
      },
    });
    await h.connect();
    const host = createWiringHost({ name: "test-host", kind: "server", ports: { loggerFor: () => silent } });
    host.adoptServer({
      manifest: marketplaceManifest,
      server: marketplaceServerManifest,
      bindings: {
        http: {
          mountPath: "/api",
          config: { engine: h.engine, copy: MARKETPLACE_SERVER_COPY_EN_US, tenantBySlug: async () => TENANT, logger: silent },
        },
        jobs: { deps: { engine: h.engine } },
      },
    });
    const wired = host.assemble();

    expect(wired.jobs.map((job) => job.name).sort()).toEqual([
      "marketplace.catalogue",
      "marketplace.expire-acceptances",
      "marketplace.fetch-order",
      "marketplace.outbound",
      "marketplace.outbound-sweep",
      "marketplace.reconcile-inbox",
    ]);
    expect(wired.routes).toHaveLength(7);
    expect(wired.mcpEndpoints.map((tool) => tool.path)).toContain("/api/admin/{tenantSlug}/marketplace/acceptances");

    const event = h.engine.normalize("IFOOD", { id: "e", code: "PLC", orderId: "ext-1", order: { items: [{ externalCode: "S", name: "S", quantity: 1, unitPrice: 1 }] } });
    await h.engine.deliver({ clientId: TENANT, event: event!, payload: {}, settings: { autoAccept: true, ackSlaSeconds: 300 } });
    const job = wired.jobs.find((candidate) => candidate.name === "marketplace.outbound")!;
    const context = { runId: "r", attempt: 1, maxAttempts: 3, logger: silent };
    await expect(
      job.handle({ clientId: TENANT, orderId: "order-1", action: "confirm" } as never, context),
    ).rejects.toThrow(/confirm/);
  });
});
