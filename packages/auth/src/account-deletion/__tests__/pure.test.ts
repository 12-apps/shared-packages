import { describe, expect, it } from "vitest";

import { accountDeletionMail, dueReminder, isFreshSignIn, isOpenWhilePending, standingOf } from "..";

const DAY = 24 * 60 * 60 * 1000;
const T0_MS = Date.UTC(2026, 10, 19, 15);
const t0 = (): Date => new Date(T0_MS);
const rowAt = () => ({
  userId: "u", sessionEpoch: 1, requestedAt: t0(), purgeAt: new Date(T0_MS + 15 * DAY),
  remindedWeekAt: null, remindedDayAt: null, mailOwed: null, mailPurgeAt: null, mailClaimedAt: null, purgeClaimedAt: null, deletedAt: null,
});

describe("standingOf", () => {
  it("admits epoch 0 with no row, and refuses a stale or purged token", () => {
    expect(standingOf({}, null)).toEqual({ state: "ok" });
    expect(standingOf({ sv: "0" }, rowAt())).toEqual({ state: "revoked" });
    expect(standingOf({ sv: "1" }, { ...rowAt(), deletedAt: t0() })).toEqual({ state: "revoked" });
    expect(standingOf({ bearer: true }, { ...rowAt(), requestedAt: null, purgeAt: null })).toEqual({ state: "ok" });
  });
  it("opens only the deletion's routes while pending", () => {
    expect(isOpenWhilePending("/api/d/cancel", "/api/d")).toBe(true);
    expect(isOpenWhilePending("/api/dx", "/api/d")).toBe(false);
  });
});

describe("dueReminder and freshness", () => {
  it("skips a reminder a short window never reaches", () => {
    const short = { ...rowAt(), purgeAt: new Date(T0_MS + 3 * DAY) };
    expect(dueReminder(short, new Date(T0_MS + DAY))).toBeNull();
    expect(dueReminder(short, new Date(T0_MS + 2.5 * DAY))).toBe("day-before");
  });
  it("is not fresh with no claim, a garbled one, or one from the future", () => {
    expect(isFreshSignIn(String(T0_MS - 60_000), T0_MS, 600_000)).toBe(true);
    expect(isFreshSignIn("NaN", T0_MS, 600_000)).toBe(false);
    expect(isFreshSignIn(String(T0_MS + 60_000), T0_MS, 600_000)).toBe(false);
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
