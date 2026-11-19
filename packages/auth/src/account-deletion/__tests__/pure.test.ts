import { describe, expect, it } from "vitest";

import { accountDeletionMail, dueReminder, isOpenWhilePending, standingOf } from "..";

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date("2026-11-19T15:00:00.000Z");
const row = { userId: "u", sessionEpoch: 1, requestedAt: T0, purgeAt: new Date(T0.getTime() + 15 * DAY), remindedWeekAt: null, remindedDayAt: null, deletedAt: null };

describe("standingOf", () => {
  it("admits epoch 0 with no row, and refuses a stale or purged token", () => {
    expect(standingOf({}, null)).toEqual({ state: "ok" });
    expect(standingOf({ sv: "0" }, row)).toEqual({ state: "revoked" });
    expect(standingOf({ sv: "1" }, { ...row, deletedAt: T0 })).toEqual({ state: "revoked" });
    expect(standingOf({ bearer: true }, { ...row, requestedAt: null, purgeAt: null })).toEqual({ state: "ok" });
  });
  it("opens only the deletion's routes while pending", () => {
    expect(isOpenWhilePending("/api/d/cancel", "/api/d")).toBe(true);
    expect(isOpenWhilePending("/api/dx", "/api/d")).toBe(false);
  });
});

describe("dueReminder", () => {
  it("skips a reminder a short window never reaches", () => {
    const short = { ...row, purgeAt: new Date(T0.getTime() + 3 * DAY) };
    expect(dueReminder(short, new Date(T0.getTime() + DAY))).toBeNull();
    expect(dueReminder(short, new Date(T0.getTime() + 2.5 * DAY))).toBe("day-before");
  });
});

describe("the mails", () => {
  it("say excluir and the date, and that the last one cannot be recovered", () => {
    const purgeAt = new Date("2026-12-04T15:00:00.000Z");
    expect(accountDeletionMail("scheduled", purgeAt, "pt-BR").subject).toBe("Sua conta será excluída em 4 de dezembro");
    expect(accountDeletionMail("day-before", purgeAt, "pt-BR").lead).toContain("não dá para recuperar");
    expect(accountDeletionMail("week-before", purgeAt, "en-US").subject).toBe("7 days left: your account will be deleted on December 4");
  });
});
