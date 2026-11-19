import { describe, expect, it, vi } from "vitest";

import { createAccountDeletion } from "..";
import type { AccountDeletionConfig, DeletionCaller, DeletionMail } from "../types";
import { memoryDb } from "./memory-db";

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date("2026-11-19T15:00:00.000Z");
const PERSON: DeletionCaller = { userId: "u1", email: "pessoa@example.com", signedInAt: String(T0.getTime()) };

function world(over: Partial<AccountDeletionConfig> = {}) {
  const db = memoryDb();
  const mails: DeletionMail[] = [];
  const audits: Array<[string, string]> = [];
  const erase = vi.fn(async () => undefined);
  const feature = createAccountDeletion({
    graceDays: 15,
    resolveCaller: async () => PERSON,
    hasPassword: async () => true,
    checkPassword: async (_email, password) => (password === "right" ? "ok" : password === "spam" ? "rate-limited" : "wrong"),
    erase,
    emailOf: async () => PERSON.email,
    mail: async (message) => void mails.push(message),
    audit: async (act, userId) => void audits.push([act, userId]),
    getDb: () => db,
    ...over,
  });
  return { db, mails, audits, erase, feature };
}

describe("account deletion (FUT-5322)", () => {
  it("schedules with the password: moves the epoch, stamps the window, audits and mails", async () => {
    const { feature, mails, audits, db } = world();
    const before = await feature.signInClaims("u1", T0);
    expect(before.sv).toBe("0");
    const outcome = await feature.schedule(PERSON, "right", T0);
    expect(outcome).toEqual({ ok: true, purgeAt: new Date(T0.getTime() + 15 * DAY) });
    expect(db.rows.get("u1")?.sessionEpoch).toBe(1);
    expect(await feature.standing("u1", { sv: before.sv })).toEqual({ state: "revoked" });
    expect(await feature.standing("u1", { sv: "1" })).toMatchObject({ state: "pending" });
    expect(audits).toEqual([["scheduled", "u1"]]);
    expect(mails.map((mail) => mail.kind)).toEqual(["scheduled"]);
  });

  it("refuses a wrong password, a rate limit, an impersonator, and a blocker, changing nothing", async () => {
    const { feature, db } = world({ blockers: async (userId) => (userId === "blocked" ? [{ kind: "order", label: "Loja", href: "/p/1" }] : []) });
    expect(await feature.schedule(PERSON, "wrong", T0)).toEqual({ ok: false, reason: "wrong-password" });
    expect(await feature.schedule(PERSON, "spam", T0)).toEqual({ ok: false, reason: "rate-limited" });
    expect(await feature.schedule({ ...PERSON, impersonated: true }, "right", T0)).toEqual({ ok: false, reason: "impersonating" });
    expect(await feature.schedule({ ...PERSON, userId: "blocked" }, "right", T0)).toEqual({ ok: false, reason: "blocked" });
    expect(db.rows.size).toBe(0);
  });

  it("lets a Google-only account confirm with a fresh sign-in, and only a fresh one", async () => {
    const { feature } = world({ hasPassword: async () => false });
    const stale = { ...PERSON, signedInAt: String(T0.getTime() - 60 * 60_000) };
    expect(await feature.schedule(stale, null, T0)).toEqual({ ok: false, reason: "sign-in-again" });
    expect((await feature.schedule(PERSON, null, T0)).ok).toBe(true);
  });

  it("cancels within the window: the account is as it was, the old token stays out", async () => {
    const { feature, audits, mails } = world();
    await feature.schedule(PERSON, "right", T0);
    expect(await feature.cancel(PERSON, T0)).toEqual({ ok: true });
    expect(await feature.standing("u1", { sv: "1" })).toEqual({ state: "ok" });
    expect(await feature.standing("u1", { sv: "0" })).toEqual({ state: "revoked" });
    expect(await feature.cancel(PERSON, T0)).toEqual({ ok: false, reason: "not-scheduled" });
    expect(audits.map(([act]) => act)).toEqual(["scheduled", "cancelled"]);
    expect(mails.map((mail) => mail.kind)).toEqual(["scheduled", "cancelled"]);
  });

  it("reminds 7 days and 1 day before, each once, then purges once and only once", async () => {
    const { feature, mails, erase, audits } = world();
    await feature.schedule(PERSON, "right", T0);
    expect(await feature.sweep(new Date(T0.getTime() + 2 * DAY))).toEqual({ reminded: 0, purged: 0, failed: 0 });
    expect(await feature.sweep(new Date(T0.getTime() + 8 * DAY + 60_000))).toEqual({ reminded: 1, purged: 0, failed: 0 });
    expect(await feature.sweep(new Date(T0.getTime() + 9 * DAY))).toEqual({ reminded: 0, purged: 0, failed: 0 });
    expect(await feature.sweep(new Date(T0.getTime() + 14 * DAY + 60_000))).toEqual({ reminded: 1, purged: 0, failed: 0 });
    expect(await feature.sweep(new Date(T0.getTime() + 15 * DAY))).toEqual({ reminded: 0, purged: 1, failed: 0 });
    expect(await feature.sweep(new Date(T0.getTime() + 16 * DAY))).toEqual({ reminded: 0, purged: 0, failed: 0 });
    expect(mails.map((mail) => mail.kind)).toEqual(["scheduled", "week-before", "day-before"]);
    expect(erase).toHaveBeenCalledTimes(1);
    expect(audits.map(([act]) => act)).toEqual(["scheduled", "purged"]);
    expect(await feature.standing("u1", { sv: "1" })).toEqual({ state: "revoked" });
  });

  it("gives a purge that failed back to the next pass", async () => {
    const erase = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(undefined);
    const { feature } = world({ erase });
    await feature.schedule(PERSON, "right", T0);
    const due = new Date(T0.getTime() + 15 * DAY);
    expect(await feature.sweep(due)).toEqual({ reminded: 0, purged: 0, failed: 1 });
    expect(await feature.sweep(due)).toEqual({ reminded: 0, purged: 1, failed: 0 });
  });

  it("does not let a mail that fails undo the act", async () => {
    const { feature } = world({ mail: async () => Promise.reject(new Error("no driver")) });
    expect((await feature.schedule(PERSON, "right", T0)).ok).toBe(true);
  });
});

describe("the routes", () => {
  it("answer the screen, refuse with a code and the reader's words, and schedule", async () => {
    const { feature } = world();
    const get = await feature.routes.GET(new Request("https://x.test/d"));
    expect(((await get.json()) as { data: { canSchedule: boolean; graceDays: number } }).data).toMatchObject({ canSchedule: true, graceDays: 15 });
    const wrong = await feature.routes.POST(new Request("https://x.test/d", { method: "POST", body: JSON.stringify({ password: "nope" }) }));
    expect(wrong.status).toBe(403);
    expect(await wrong.json()).toEqual({ error: "Senha incorreta.", code: "wrong-password" });
    const bad = await feature.routes.POST(new Request("https://x.test/d", { method: "POST", body: JSON.stringify({ extra: 1 }) }));
    expect(bad.status).toBe(400);
    const ok = await feature.routes.POST(new Request("https://x.test/d", { method: "POST", body: JSON.stringify({ password: "right" }) }));
    expect(ok.status).toBe(200);
    const cancel = await feature.routes.cancel(new Request("https://x.test/d/cancel", { method: "POST", body: "{}" }));
    expect(await cancel.json()).toEqual({ data: { cancelled: true } });
  });

  it("answer 401 to nobody", async () => {
    const { feature } = world({ resolveCaller: async () => null });
    expect((await feature.routes.GET(new Request("https://x.test/d"))).status).toBe(401);
  });
});
