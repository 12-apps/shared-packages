import { describe, expect, it, vi } from "vitest";

import { createAccountDeletion } from "..";
import type { AccountDeletionConfig, DeletionCaller, DeletionMail } from "../types";
import { memoryDb } from "./memory-db";

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date("2026-11-19T15:00:00.000Z");
const at = (days: number, ms = 0): Date => new Date(T0.getTime() + days * DAY + ms);
const PERSON: DeletionCaller = { userId: "u1", email: "pessoa@example.com", signedInAt: String(T0.getTime()) };

function world(over: Partial<AccountDeletionConfig> = {}) {
  const db = memoryDb();
  const mails: DeletionMail[] = [];
  const audits: Array<[string, string]> = [];
  const errors: string[] = [];
  const erase = vi.fn(async () => undefined);
  const feature = createAccountDeletion({
    graceDays: 15,
    timeZone: "UTC",
    userIdByEmail: async () => "u1",
    resolveCaller: async () => PERSON,
    hasPassword: async () => true,
    checkPassword: async (_email, password) => (password === "right" ? "ok" : password === "spam" ? "rate-limited" : "wrong"),
    erase,
    emailOf: async () => PERSON.email,
    mail: async (message) => void mails.push(message),
    audit: async (act, userId) => void audits.push([act, userId]),
    onError: (_error, context) => void errors.push(context.act),
    getDb: () => db,
    ...over,
  });
  return { db, mails, audits, errors, erase, feature };
}

describe("scheduling", () => {
  it("moves the epoch, stamps the window, audits and mails once; the old token is refused", async () => {
    const { feature, mails, audits, db } = world();
    expect((await feature.signInClaims("u1", "google", T0)).sv).toBe("0");
    expect(await feature.schedule(PERSON, "right", T0)).toEqual({ ok: true, purgeAt: at(15) });
    expect(db.rows.get("u1")).toMatchObject({ sessionEpoch: 1, mailOwed: null });
    expect(await feature.standing("u1", { sv: "0" })).toEqual({ state: "revoked" });
    expect(await feature.standing("u1", { sv: "1" })).toEqual({ state: "pending", purgeAt: at(15) });
    expect(audits).toEqual([["scheduled", "u1"]]);
    expect(mails.map((mail) => [mail.kind, mail.purgeAt])).toEqual([["scheduled", at(15)]]);
  });

  it("schedules once on a double tap: one epoch move, one audit, one mail", async () => {
    const { feature, mails, audits, db } = world();
    const both = await Promise.all([feature.schedule(PERSON, "right", T0), feature.schedule(PERSON, "right", T0)]);
    expect(both.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(both.find((outcome) => !outcome.ok)).toEqual({ ok: false, reason: "pending" });
    expect(db.rows.get("u1")?.sessionEpoch).toBe(1);
    expect(audits).toHaveLength(1);
    expect(mails).toHaveLength(1);
  });

  it("refuses a wrong password, a rate limit, an impersonator and a blocker, writing nothing", async () => {
    const { feature, db } = world({ blockers: async (userId) => (userId === "blocked" ? [{ kind: "order", label: "Loja", href: "/p/1" }] : []) });
    expect(await feature.schedule(PERSON, "wrong", T0)).toEqual({ ok: false, reason: "wrong-password" });
    expect(await feature.schedule(PERSON, "spam", T0)).toEqual({ ok: false, reason: "rate-limited" });
    expect(await feature.schedule({ ...PERSON, impersonated: true }, "right", T0)).toEqual({ ok: false, reason: "impersonating" });
    expect(await feature.schedule({ ...PERSON, userId: "blocked" }, "right", T0)).toEqual({ ok: false, reason: "blocked" });
    expect(db.rows.size).toBe(0);
  });

  it("confirms a password-less account with a fresh sign-in only", async () => {
    const { feature } = world({ hasPassword: async () => false });
    expect(await feature.schedule({ ...PERSON, signedInAt: String(T0.getTime() - 60 * 60_000) }, null, T0)).toEqual({ ok: false, reason: "sign-in-again" });
    expect((await feature.schedule(PERSON, null, T0)).ok).toBe(true);
  });

  it("stamps the sign-in time only for a provider that may stand in for a password", async () => {
    const { feature } = world();
    expect(await feature.signInClaims("u1", "google", T0)).toEqual({ sv: "0", at: String(T0.getTime()) });
    expect(await feature.signInClaims("u1", "email-link", T0)).toEqual({ sv: "0" });
  });

  it("still audits and mails when the host's onScheduled hook fails, and says so", async () => {
    const { feature, audits, mails, errors } = world({ onScheduled: async () => Promise.reject(new Error("links")) });
    expect((await feature.schedule(PERSON, "right", T0)).ok).toBe(true);
    expect(audits).toHaveLength(1);
    expect(mails).toHaveLength(1);
    expect(errors).toEqual(["onScheduled"]);
  });

  it("refuses a nonsense window or zone at construction", () => {
    expect(() => world({ graceDays: 0 })).toThrow(/graceDays/);
    expect(() => world({ graceDays: 1.5 })).toThrow(/graceDays/);
    expect(() => world({ timeZone: "Mars/Olympus" })).toThrow(/timeZone/);
  });
});

describe("cancelling", () => {
  it("restores the account, moves the epoch again, audits and mails", async () => {
    const { feature, audits, mails } = world();
    await feature.schedule(PERSON, "right", T0);
    expect(await feature.cancel(PERSON, at(1))).toEqual({ ok: true });
    expect(await feature.standing("u1", { sv: "1" })).toEqual({ state: "revoked" });
    expect(await feature.standing("u1", { sv: "2" })).toEqual({ state: "ok" });
    expect(await feature.cancel(PERSON, at(1))).toEqual({ ok: false, reason: "not-scheduled" });
    expect(audits.map(([act]) => act)).toEqual(["scheduled", "cancelled"]);
    expect(mails.map((mail) => mail.kind)).toEqual(["scheduled", "cancelled"]);
  });

  it("cannot cancel once the purge claimed the account", async () => {
    const erase = vi.fn().mockRejectedValue(new Error("half way"));
    const { feature } = world({ erase });
    await feature.schedule(PERSON, "right", T0);
    await feature.sweep(at(15));
    expect(await feature.cancel(PERSON, at(15, 1))).toEqual({ ok: false, reason: "not-scheduled" });
  });

  it("leaves nothing for the sweep after a cancel, and a re-schedule never gets the old date", async () => {
    const { feature, mails } = world();
    await feature.schedule(PERSON, "right", T0);
    await feature.cancel(PERSON, at(5));
    expect(await feature.sweep(at(9))).toEqual({ mailed: 0, purged: 0, failed: 0 });
    await feature.schedule(PERSON, "right", at(6));
    await feature.sweep(at(15));
    expect(mails.filter((mail) => mail.kind === "week-before").map((mail) => mail.purgeAt)).toEqual([at(21)]);
  });
});

describe("the sweep", () => {
  it("reminds 7 days and 1 day before, each once, then purges once at the boundary", async () => {
    const { feature, mails, erase, audits } = world();
    await feature.schedule(PERSON, "right", T0);
    expect(await feature.sweep(at(2))).toEqual({ mailed: 0, purged: 0, failed: 0 });
    expect(await feature.sweep(at(8, 60_000))).toEqual({ mailed: 1, purged: 0, failed: 0 });
    expect(await feature.sweep(at(9))).toEqual({ mailed: 0, purged: 0, failed: 0 });
    expect(await feature.sweep(at(14, 60_000))).toEqual({ mailed: 1, purged: 0, failed: 0 });
    expect(await feature.sweep(at(15, -1))).toEqual({ mailed: 0, purged: 0, failed: 0 });
    expect(await feature.sweep(at(15))).toEqual({ mailed: 0, purged: 1, failed: 0 });
    expect(await feature.sweep(at(16))).toEqual({ mailed: 0, purged: 0, failed: 0 });
    expect(mails.map((mail) => mail.kind)).toEqual(["scheduled", "week-before", "day-before"]);
    expect(erase).toHaveBeenCalledTimes(1);
    expect(audits.map(([act]) => act)).toEqual(["scheduled", "purged"]);
    expect(await feature.standing("u1", { sv: "1" })).toEqual({ state: "revoked" });
  });

  it("retries a reminder whose mail failed, and sends it once when the driver is back", async () => {
    let down = true;
    const sent: string[] = [];
    const { feature, errors } = world({
      mail: async (message) => {
        if (down && message.kind === "week-before") throw new Error("driver down");
        sent.push(message.kind);
      },
    });
    await feature.schedule(PERSON, "right", T0);
    expect(await feature.sweep(at(8, 60_000))).toEqual({ mailed: 0, purged: 0, failed: 0 });
    expect(errors).toContain("mail:week-before");
    expect(await feature.sweep(at(9))).toEqual({ mailed: 0, purged: 0, failed: 1 });
    down = false;
    expect(await feature.sweep(at(9, 1))).toEqual({ mailed: 1, purged: 0, failed: 0 });
    expect(await feature.sweep(at(9, 2))).toEqual({ mailed: 0, purged: 0, failed: 0 });
    expect(sent).toEqual(["scheduled", "week-before"]);
  });

  it("keeps the scheduled mail owed while the person's e-mail is unknown, and sends it later", async () => {
    let email: string | null = null;
    const { feature, mails } = world({ emailOf: async () => email });
    await feature.schedule(PERSON, "right", T0);
    expect(mails).toEqual([]);
    email = "pessoa@example.com";
    expect(await feature.sweep(at(1))).toEqual({ mailed: 1, purged: 0, failed: 0 });
    expect(mails.map((mail) => mail.kind)).toEqual(["scheduled"]);
  });

  it("runs a purge whose erase failed again after its lease, and only then", async () => {
    const erase = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(undefined);
    const { feature } = world({ erase });
    await feature.schedule(PERSON, "right", T0);
    expect(await feature.sweep(at(15))).toEqual({ mailed: 0, purged: 0, failed: 1 });
    expect(await feature.sweep(at(15, 60_000))).toEqual({ mailed: 0, purged: 0, failed: 0 });
    expect(await feature.sweep(at(15, 31 * 60_000))).toEqual({ mailed: 0, purged: 1, failed: 0 });
    expect(erase).toHaveBeenCalledTimes(2);
  });

  it("purges once when two sweeps run at the same time", async () => {
    const { feature, erase } = world();
    await feature.schedule(PERSON, "right", T0);
    const [a, b] = await Promise.all([feature.sweep(at(15)), feature.sweep(at(15))]);
    expect(a.purged + b.purged).toBe(1);
    expect(erase).toHaveBeenCalledTimes(1);
  });

  it("is not starved by rows that need nothing", async () => {
    const { feature, db, mails } = world();
    for (let index = 0; index < 60; index += 1) {
      await db.authAccountState.create({ data: { userId: `quiet-${index}`, requestedAt: T0, purgeAt: at(12), remindedWeekAt: T0 } });
    }
    await feature.schedule(PERSON, "right", at(1));
    expect((await feature.sweep(at(9))).mailed).toBe(1);
    expect(mails.at(-1)?.kind).toBe("week-before");
  });
});

describe("the routes", () => {
  const post = (body: unknown, path = "https://x.test/d"): Request =>
    new Request(path, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });

  it("answer the screen, refuse with a code and the reader's words, and schedule", async () => {
    const { feature } = world();
    const get = await feature.routes.GET(new Request("https://x.test/d"));
    expect(((await get.json()) as { data: { canSchedule: boolean; graceDays: number } }).data).toMatchObject({ canSchedule: true, graceDays: 15 });
    const wrong = await feature.routes.POST(post({ password: "nope" }));
    expect([wrong.status, await wrong.json()]).toEqual([403, { error: "Senha incorreta.", code: "wrong-password" }]);
    expect((await feature.routes.POST(post({ password: "spam" }))).status).toBe(429);
    expect((await feature.routes.POST(post({ extra: 1 }))).status).toBe(400);
    expect((await feature.routes.POST(post({ password: "right" }))).status).toBe(200);
    expect((await feature.routes.POST(post({ password: "right" }))).status).toBe(409);
    expect(await (await feature.routes.cancel(post("{}", "https://x.test/d/cancel"))).json()).toEqual({ data: { cancelled: true } });
    expect((await feature.routes.cancel(post("{}", "https://x.test/d/cancel"))).status).toBe(409);
  });

  it("refuse an impersonator on both acts, and nobody with 401", async () => {
    const { feature } = world({ resolveCaller: async () => ({ ...PERSON, impersonated: true }) });
    expect((await feature.routes.POST(post({ password: "right" }))).status).toBe(403);
    expect((await feature.routes.cancel(post("{}"))).status).toBe(403);
    const nobody = world({ resolveCaller: async () => null }).feature;
    expect((await nobody.routes.GET(new Request("https://x.test/d"))).status).toBe(401);
  });
});
