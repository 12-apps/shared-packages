import { describe, expect, it } from "vitest";

import { accountDeletionMail, dueReminder, isFreshSignIn, isOpenWhilePending, standingOf } from "..";

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date("2026-11-19T15:00:00.000Z");
const row = {
  userId: "u", sessionEpoch: 1, requestedAt: T0, purgeAt: new Date(T0.getTime() + 15 * DAY),
  remindedWeekAt: null, remindedDayAt: null, mailOwed: null, mailPurgeAt: null, purgeClaimedAt: null, deletedAt: null,
};

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

describe("dueReminder and freshness", () => {
  it("skips a reminder a short window never reaches", () => {
    const short = { ...row, purgeAt: new Date(T0.getTime() + 3 * DAY) };
    expect(dueReminder(short, new Date(T0.getTime() + DAY))).toBeNull();
    expect(dueReminder(short, new Date(T0.getTime() + 2.5 * DAY))).toBe("day-before");
  });
  it("is not fresh with no claim, a garbled one, or one from the future", () => {
    expect(isFreshSignIn(String(T0.getTime() - 60_000), T0.getTime(), 600_000)).toBe(true);
    expect(isFreshSignIn("NaN", T0.getTime(), 600_000)).toBe(false);
    expect(isFreshSignIn(String(T0.getTime() + 60_000), T0.getTime(), 600_000)).toBe(false);
  });
});

describe("the mails", () => {
  it("say excluir and the date in the configured zone, and that the last one cannot be recovered", () => {
    const purgeAt = new Date("2026-12-04T02:30:00.000Z");
    expect(accountDeletionMail("scheduled", purgeAt, "pt-BR", "America/Sao_Paulo").subject).toBe("Sua conta será excluída em 3 de dezembro");
    expect(accountDeletionMail("scheduled", purgeAt, "pt-BR", "UTC").subject).toBe("Sua conta será excluída em 4 de dezembro");
    expect(accountDeletionMail("day-before", purgeAt, "pt-BR", "UTC").lead).toContain("não dá para recuperar");
    expect(accountDeletionMail("week-before", purgeAt, "en-US", "UTC").subject).toBe("7 days left: your account will be deleted on December 4");
  });
});
