// @vitest-environment node
/**
 * The card-on-file HTTP surface (FUT-340).
 *
 * Two things are pinned: the copy is genuinely required — a host cannot mount
 * this and silently answer in a language it never chose — and every write
 * answers with the resulting card list, so a screen needs one call rather than
 * a write plus a re-read that can disagree with it.
 */
import { describe, expect, it } from "vitest";

import { BillingConfigError } from "../errors";
import {
  copyOf,
  createApiBilling,
  type BillingActor,
  type BillingApiCopy,
} from "../server/routes";
import type { WireRequest, WireRoute } from "@12-apps/wiring";
import {
  MERCHANT,
  TARGET,
  fakeDirectory,
  fakeGateway,
  fakeInstruments,
  fakePayments,
} from "./fixtures";

const COPY: BillingApiCopy = {
  rejections: {
    "no-platform-account": { status: 503, message: "Subscription billing is not configured here." },
    "no-subscription": { status: 404, message: "There is no subscription to attach a card to." },
    "provider-cannot-vault": { status: 503, message: "The active acquirer cannot save cards." },
  },
  detachFailed: { status: 502, message: "Could not reach the provider to remove the card." },
  invalidSession: { status: 400, message: "A vault session id is required." },
};

const CARDS = [
  { provider: "acquirer-a", brand: "visa", last4: "4242", expMonth: 12, expYear: 2030, isDefault: true },
];

function surface(options: { enabled?: boolean; pointers?: never[] } = {}) {
  const gateway = fakeGateway();
  const { payments } = fakePayments(gateway);
  const instruments = fakeInstruments([], CARDS);
  const api = createApiBilling({
    payments,
    merchant: MERCHANT,
    enabled: async () => options.enabled ?? true,
    subscriptions: fakeDirectory(TARGET),
    instruments,
    copy: COPY,
  });
  return { api, gateway, instruments };
}

function route(
  routes: readonly WireRoute<BillingActor>[],
  method: string,
  path: string,
): WireRoute<BillingActor> {
  const found = routes.find((candidate) => candidate.method === method && candidate.path === path);
  if (!found) throw new Error(`no route for ${method} ${path}`);
  return found;
}

function request(over: Partial<WireRequest<BillingActor>> = {}): WireRequest<BillingActor> {
  return { actor: { ownerId: "owner-1" }, params: {}, query: {}, ...over };
}

describe("the copy is required", () => {
  function mount(copy: unknown) {
    return () =>
      createApiBilling({
        payments: fakePayments(fakeGateway()).payments,
        merchant: MERCHANT,
        enabled: async () => true,
        subscriptions: fakeDirectory(TARGET),
        instruments: fakeInstruments(),
        copy: copy as BillingApiCopy,
      });
  }

  it("refuses to mount with no copy at all", () => {
    expect(mount(undefined)).toThrow(BillingConfigError);
  });

  it("refuses a rejection this surface can actually produce but the host did not word", () => {
    expect(
      mount({ ...COPY, rejections: { ...COPY.rejections, "provider-cannot-vault": undefined } }),
    ).toThrow(BillingConfigError);
  });

  it("refuses a blank sentence — a refusal with no words is a 500", () => {
    expect(mount({ ...COPY, detachFailed: { status: 502, message: "  " } })).toThrow(
      BillingConfigError,
    );
  });

  it("refuses a status that is not a refusal", () => {
    expect(mount({ ...COPY, invalidSession: { status: 200, message: "fine" } })).toThrow(
      BillingConfigError,
    );
  });
});

describe("the four endpoints", () => {
  it("declares exactly the card surface, and nothing that writes money", () => {
    const { api } = surface();
    expect(api.routes.map((entry) => `${entry.method} ${entry.path}`).sort()).toEqual([
      "DELETE /card",
      "GET /card",
      "POST /card",
      "POST /card/session",
    ]);
  });

  it("reads the owner's cards", async () => {
    const { api } = surface();
    await expect(route(api.routes, "GET", "/card").handle(request())).resolves.toEqual({
      status: 200,
      body: { cards: CARDS },
    });
  });

  it("opens a session and hands the browser what it needs", async () => {
    const { api } = surface();
    const response = await route(api.routes, "POST", "/card/session").handle(request());
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ provider: "acquirer-a", sessionId: "sess-1" });
  });

  it("answers a rejection in the host's words and with the host's status", async () => {
    const { api } = surface({ enabled: false });
    await expect(route(api.routes, "POST", "/card/session").handle(request())).resolves.toEqual({
      status: 503,
      body: { message: COPY.rejections["no-platform-account"].message },
    });
  });

  it("refuses a complete with no usable session id, before reaching the provider", async () => {
    const { api, gateway } = surface();
    const complete = route(api.routes, "POST", "/card");
    for (const body of [undefined, {}, { sessionId: "" }, { sessionId: 7 }]) {
      await expect(complete.handle(request({ body }))).resolves.toEqual({
        status: 400,
        body: { message: COPY.invalidSession.message },
      });
    }
    expect(gateway.completeVault).not.toHaveBeenCalled();
  });

  it("answers a completed vault with the resulting list, so a screen needs one call", async () => {
    const { api, instruments } = surface();
    const response = await route(api.routes, "POST", "/card").handle(
      request({ body: { sessionId: "sess-1" } }),
    );
    expect(instruments.saved).toHaveLength(1);
    expect(response).toEqual({ status: 200, body: { cards: CARDS } });
  });

  it("answers a removal with the resulting list too", async () => {
    const { api } = surface();
    await expect(route(api.routes, "DELETE", "/card").handle(request())).resolves.toEqual({
      status: 200,
      body: { cards: CARDS },
    });
  });
});

describe("the copy can follow the reader", () => {
  /**
   * `createApiBilling` assembles its route table ONCE at the host's mount, and
   * the four handlers below it run per request. The old `const { copy } =
   * config` closed over one pack there, so every tenant for the life of the
   * process was refused in whichever language that mount was built with — and
   * a single-locale host could not tell that from correct.
   */
  const OTHER: BillingApiCopy = {
    rejections: {
      "no-platform-account": { status: 503, message: "[other] not configured" },
      "no-subscription": { status: 404, message: "[other] no subscription" },
      "provider-cannot-vault": { status: 503, message: "[other] cannot save cards" },
    },
    detachFailed: { status: 502, message: "[other] could not reach the provider" },
    invalidSession: { status: 400, message: "[other] a session id is required" },
  };

  const pickByLocale = ({ locale }: { readonly locale?: string | null }) =>
    locale === "en-US" ? OTHER : COPY;

  function resolverSurface() {
    const gateway = fakeGateway();
    const { payments } = fakePayments(gateway);
    return createApiBilling({
      payments,
      merchant: MERCHANT,
      enabled: async () => true,
      subscriptions: fakeDirectory(TARGET),
      instruments: fakeInstruments([], CARDS),
      copy: pickByLocale,
    });
  }

  it("answers two callers in their own languages from ONE mount", async () => {
    const { routes } = resolverSurface();
    const complete = route(routes, "POST", "/card");

    // No session id: the refusal is this surface's own, and needs no provider.
    const [pt, en] = await Promise.all([
      complete.handle(request({ body: {}, locale: "pt-BR" })),
      complete.handle(request({ body: {}, locale: "en-US" })),
    ]);

    expect(pt.body).toEqual({ message: COPY.invalidSession.message });
    expect(en.body).toEqual({ message: OTHER.invalidSession.message });
  });

  it("keeps the STATUS fixed while the sentence follows the reader", async () => {
    // Rule H on the half a client branches on. A 400 that became a 404 in
    // another language would make error handling language-dependent.
    const { routes } = resolverSurface();
    const complete = route(routes, "POST", "/card");

    const [pt, en] = await Promise.all([
      complete.handle(request({ body: {}, locale: "pt-BR" })),
      complete.handle(request({ body: {}, locale: "en-US" })),
    ]);

    expect(en.status).toBe(pt.status);
    expect(en.body).not.toEqual(pt.body);
  });

  it("validates a resolver's DEFAULT rendering at the mount", () => {
    /**
     * Rule E, and why the mount asks with no locale at all.
     *
     * A host that forgot a sentence must still fail at ASSEMBLY, where a
     * reviewer sees it — not on the one request that happens to need the
     * missing refusal. So the mount resolves with `undefined` and validates
     * what comes back.
     */
    const incomplete = () =>
      createApiBilling({
        payments: fakePayments(fakeGateway()).payments,
        merchant: MERCHANT,
        enabled: async () => true,
        subscriptions: fakeDirectory(TARGET),
        instruments: fakeInstruments([], CARDS),
        copy: () => ({ ...COPY, invalidSession: undefined }) as unknown as BillingApiCopy,
      });

    expect(incomplete).toThrow(BillingConfigError);
  });

  it("asks the resolver with no locale at the mount, then per request", () => {
    const asked: Array<string | null | undefined> = [];
    const { routes } = createApiBilling({
      payments: fakePayments(fakeGateway()).payments,
      merchant: MERCHANT,
      enabled: async () => true,
      subscriptions: fakeDirectory(TARGET),
      instruments: fakeInstruments([], CARDS),
      copy: ({ locale }) => {
        asked.push(locale);
        return COPY;
      },
    });

    expect(asked).toEqual([undefined]);

    void route(routes, "POST", "/card").handle(
      request({ body: {}, locale: "en-US" }),
    );
    expect(asked).toEqual([undefined, "en-US"]);
  });
});

describe("copyOf", () => {
  it("passes a plain pack through and asks a resolver for its locale", () => {
    expect(copyOf({ copy: COPY }, "en-US")).toBe(COPY);
    expect(copyOf({ copy: ({ locale }) => (locale === "en-US" ? COPY : COPY) }, "en-US")).toBe(COPY);
  });
});
