import { describe, expect, it } from "vitest";

import { createReportBudget, describeDesktopReport, desktopReportSchema } from "../telemetry-intake";

/**
 * The crash-report intake. What matters is that a report becomes ONE string —
 * a transport that forwards only the message would otherwise carry a title and
 * nothing to act on — that a body outside the caps is refused, and that one
 * key cannot push more than its hourly budget.
 */

const CRASH = {
  kind: "crash",
  version: "0.1.60",
  occurredAt: "2026-09-25T18:00:00.000Z",
  message: "the previous run (0.1.60) did not quit cleanly",
  breadcrumbs: [{ at: "2026-09-25T17:59:59.000Z", text: "menu open" }],
  details: { dumps: "a.dmp" },
  platform: "win32",
};

describe("desktopReportSchema", () => {
  it("accepts a report as the agent sends it", () => {
    expect(desktopReportSchema.safeParse(CRASH).success).toBe(true);
  });

  it("refuses an unknown kind and an over-long message", () => {
    expect(desktopReportSchema.safeParse({ ...CRASH, kind: "anything" }).success).toBe(false);
    expect(desktopReportSchema.safeParse({ ...CRASH, message: "x".repeat(2001) }).success).toBe(false);
  });

  it("caps the stack, the trail and the details", () => {
    expect(desktopReportSchema.safeParse({ ...CRASH, stack: "x".repeat(8001) }).success).toBe(false);
    const crumb = { at: "t", text: "c" };
    expect(
      desktopReportSchema.safeParse({ ...CRASH, breadcrumbs: Array.from({ length: 31 }, () => crumb) })
        .success,
    ).toBe(false);
    const details = Object.fromEntries(Array.from({ length: 21 }, (_, n) => [`k${n}`, n]));
    expect(desktopReportSchema.safeParse({ ...CRASH, details }).success).toBe(false);
  });
});

describe("describeDesktopReport", () => {
  it("writes the whole report into one string, under the host's label", () => {
    const report = desktopReportSchema.parse({ ...CRASH, stack: "Error: boom\n  at x" });

    const line = describeDesktopReport(report, { label: "[agent]", fields: { account: "acme" } });

    expect(line.split("\n")).toEqual([
      "[agent] crash in 0.1.60: the previous run (0.1.60) did not quit cleanly",
      "account=acme at=2026-09-25T18:00:00.000Z machine=win32",
      "details: dumps=a.dmp",
      "breadcrumbs:",
      "  2026-09-25T17:59:59.000Z menu open",
      "stack:",
      "Error: boom",
      "  at x",
    ]);
  });

  it("leaves out what the report did not carry", () => {
    const report = desktopReportSchema.parse({
      kind: "error",
      version: "1.0.0",
      occurredAt: "now",
      message: "m",
      platform: "linux",
      osRelease: "6.1",
      electron: "33.2.0",
    });

    expect(describeDesktopReport(report, { label: "[agent]" })).toBe(
      "[agent] error in 1.0.0: m\nat=now machine=linux · 6.1 · electron 33.2.0",
    );
  });
});

describe("createReportBudget", () => {
  it("stops a key past its hourly budget, and gives it back the next hour", () => {
    const budget = createReportBudget({ perHour: 3 });
    const spent = [0, 1, 2, 3].map(() => budget.spend("acme", 1_000));

    expect(spent).toEqual([true, true, true, false]);
    expect(budget.spend("other", 1_000)).toBe(true);
    expect(budget.spend("acme", 1_000 + 3_600_000)).toBe(true);
  });

  it("forgets every window on reset", () => {
    const budget = createReportBudget({ perHour: 1 });
    budget.spend("acme", 0);

    budget.reset();

    expect(budget.spend("acme", 0)).toBe(true);
  });
});
