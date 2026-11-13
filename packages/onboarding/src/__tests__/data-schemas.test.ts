/* eslint-disable test-flakiness/no-test-isolation -- every `db` is a FRESH
   in-memory store built inside its own case; the rule matches the identifier
   across the file rather than its scope. */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { onboardingPatchBodyOf, type OnboardingDataSchema } from "../schemas";
import { createApiOnboarding } from "../server/create-api-onboarding";
import type { OnboardingRoute } from "../server/context";
import { PT_BR_ONBOARDING_MESSAGES } from "../server/pt-BR";
import type { OnboardingStateSnapshot } from "../types";

import { fakeOnboardingDb, type FakeOnboardingDb } from "./fake-db";

/**
 * Per-feature `data` schemas (FUT-4867): a host that requires every request
 * input closed at every depth states each guided feature's `data`, and both
 * the package's handler and the host's own route validator refuse what is not
 * declared. A feature with no schema, and a host that passes none, keep
 * today's open `data`, and progress stored before a schema existed still reads.
 */

const actor = { userId: "user-1", clientId: "tenant-a" };

/** Two features with a closed `data`, one keyed list among them; `ai_integration` has none. */
const dataSchemas = {
  team_setup: z
    .strictObject({
      position: z.string(),
      invites: z.array(z.strictObject({ email: z.string(), phone: z.string().nullable() })),
    })
    .partial(),
  first_visit: z.strictObject({}),
} satisfies Record<string, OnboardingDataSchema>;

function mount(db: FakeOnboardingDb, withSchemas: boolean) {
  const api = createApiOnboarding({
    messages: PT_BR_ONBOARDING_MESSAGES,
    db: async () => db,
    ...(withSchemas ? { dataSchemas } : {}),
  });
  const route = (method: OnboardingRoute["method"]): OnboardingRoute => {
    const found = api.routes.find((candidate) => candidate.method === method);
    if (!found) throw new Error(`no ${method} route`);
    return found;
  };
  return {
    get: (featureKey: string) => route("GET").handle({ actor, params: { featureKey }, query: {} }),
    patch: (featureKey: string, body: unknown) =>
      route("PATCH").handle({ actor, params: { featureKey }, query: {}, body }),
  };
}

const snapshotOf = (body: unknown) => (body as { data: OnboardingStateSnapshot | null }).data;

/** Zod's own description of a schema, as far as the walk below reads it. */
interface Def {
  type: string;
  [key: string]: unknown;
}

const defOf = (schema: unknown): Def | null =>
  (schema as { _zod?: { def?: Def } } | null)?._zod?.def ?? null;

/** Every open place in `schema` — the host's strict-inputs rules, over what this body is built from. */
function openPlaces(schema: unknown, path = "(root)"): string[] {
  const def = defOf(schema);
  if (!def) return [];
  if (def.type === "object") {
    const here = defOf(def.catchall)?.type === "never" ? [] : [`${path} (non-strict object)`];
    const shape = def.shape as Record<string, unknown>;
    return [...here, ...Object.entries(shape).flatMap(([key, child]) => openPlaces(child, `${path}.${key}`))];
  }
  if (["unknown", "any", "custom"].includes(def.type)) return [`${path} (${def.type})`];
  if (def.type === "record") {
    const keyOpen = ["string", "unknown", "any"].includes(defOf(def.keyType)?.type ?? "");
    return [...(keyOpen ? [`${path} (record keyed by any string)`] : []), ...openPlaces(def.valueType, `${path}{}`)];
  }
  if (def.type === "array") return openPlaces(def.element, `${path}[]`);
  if (def.type === "union") return (def.options as unknown[]).flatMap((option) => openPlaces(option, path));
  return "innerType" in def ? openPlaces(def.innerType, path) : [];
}

describe("dataSchemas on the server", () => {
  it("refuses data a feature's schema refuses, at the top and nested, as the 400", async () => {
    const { patch } = mount(fakeOnboardingDb(), true);
    for (const data of [
      { position: "riders", colour: "red" },
      { invites: [{ email: "a@b.c", phone: null, role: "admin" }] },
      { invites: { "a@b.c": { phone: null } } },
    ]) {
      const response = await patch("team_setup", { op: "save", status: "in_progress", data });
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: PT_BR_ONBOARDING_MESSAGES.invalidOperation });
    }
    expect((await patch("first_visit", { op: "save", status: "completed", data: { seen: true } })).status).toBe(400);
  });

  it("saves data that passes, shallow-merged as before", async () => {
    const { patch } = mount(fakeOnboardingDb(), true);
    await patch("team_setup", { op: "save", status: "in_progress", data: { position: "invites" } });
    const response = await patch("team_setup", {
      op: "save",
      status: "in_progress",
      data: { invites: [{ email: "a@b.c", phone: null }] },
    });
    expect(response.status).toBe(200);
    expect(snapshotOf(response.body)?.data).toEqual({
      position: "invites",
      invites: [{ email: "a@b.c", phone: null }],
    });
  });

  it("leaves a feature without a schema, and a host without any, open", async () => {
    const open = { anything: { nested: [1, 2] }, "a@b.c": { phone: null } };
    const withSchemas = mount(fakeOnboardingDb(), true);
    expect((await withSchemas.patch("ai_integration", { op: "save", status: "in_progress", data: open })).status).toBe(200);
    const without = mount(fakeOnboardingDb(), false);
    const response = await without.patch("team_setup", { op: "save", status: "in_progress", data: open });
    expect(response.status).toBe(200);
    expect(snapshotOf(response.body)?.data).toEqual(open);
  });

  it("still reads progress stored before the schema existed, and merges a valid save over it", async () => {
    const db = fakeOnboardingDb();
    // Yesterday's release: invites keyed by e-mail, a record of any string.
    const legacy = { position: "invites", invitesByEmail: { "a@b.c": { phone: null } } };
    await mount(db, false).patch("team_setup", { op: "save", status: "in_progress", data: legacy });

    const today = mount(db, true);
    expect(snapshotOf((await today.get("team_setup")).body)?.data).toEqual(legacy);
    const saved = await today.patch("team_setup", {
      op: "save",
      status: "in_progress",
      data: { invites: [{ email: "a@b.c", phone: null }] },
    });
    expect(saved.status).toBe(200);
    expect(snapshotOf(saved.body)?.data).toEqual({ ...legacy, invites: [{ email: "a@b.c", phone: null }] });
  });

  it("leaves dismiss and reset untouched by any schema", async () => {
    const { patch } = mount(fakeOnboardingDb(), true);
    expect((await patch("team_setup", { op: "dismiss" })).status).toBe(200);
    expect((await patch("team_setup", { op: "reset" })).status).toBe(200);
  });
});

describe("onboardingPatchBodyOf", () => {
  const body = onboardingPatchBodyOf(dataSchemas);

  it("has no open place at any depth when every feature schema is closed", () => {
    expect(openPlaces(body)).toEqual([]);
    expect(openPlaces(onboardingPatchBodyOf({}))).toEqual([]);
  });

  it("accepts the three operations as the client store sends them", () => {
    for (const ok of [
      { op: "save", status: "in_progress", step: "invites", data: { position: "invites" } },
      { op: "save", status: "completed", step: null },
      { op: "save", data: {} },
      { op: "dismiss" },
      { op: "reset" },
    ]) {
      expect(body.safeParse(ok).success, JSON.stringify(ok)).toBe(true);
    }
  });

  it("refuses an unknown key at every depth, and a record where a list is declared", () => {
    for (const bad of [
      { op: "save", status: "in_progress", extra: 1 },
      { op: "dismiss", status: "dismissed" },
      { op: "save", data: { position: "x", colour: "red" } },
      { op: "save", data: { invites: [{ email: "a@b.c", phone: null, role: "admin" }] } },
      { op: "save", data: { invites: { "a@b.c": { phone: null } } } },
      { op: "save", status: "almost" },
      { op: "explode" },
    ]) {
      expect(body.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("takes a single feature's schema as it is, and no data keys from an empty map", () => {
    const single = onboardingPatchBodyOf({ first_visit: z.strictObject({}) });
    expect(single.safeParse({ op: "save", data: {} }).success).toBe(true);
    expect(single.safeParse({ op: "save", data: { seen: true } }).success).toBe(false);
    expect(onboardingPatchBodyOf({}).safeParse({ op: "save", data: { seen: true } }).success).toBe(false);
  });
});
