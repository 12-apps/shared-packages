import { describe, expect, it } from "vitest";

import { formatExpiry } from "./format";

/**
 * FUT-4103 — the expiry keeps a four-digit year's last two digits.
 *
 * Autofill, a password manager (`autocomplete="cc-exp"`) or a paste can write
 * `MM/YYYY` in one go; keeping the first four digits turned `12/2034` into
 * `12/20`, an expired card.
 */
describe("formatExpiry", () => {
  it("keeps an MM/AA value as typed", () => {
    expect(formatExpiry("12/34")).toBe("12/34");
  });

  it.each(["12/2034", "12 / 2034", "122034"])("reads %s as MM + YYYY and keeps the year's last two digits", (value) => {
    expect(formatExpiry(value)).toBe("12/34");
  });

  it("keeps today's result for a one-digit month with a four-digit year", () => {
    // Not in scope to change (FUT-4103): pinned so the fix cannot make it worse.
    expect(formatExpiry("1/2034")).toBe("12/03");
  });

  it.each([
    ["six digits whose last four do not start with 20", "123456", "12/34"],
    ["seven digits", "12/20345", "12/20"],
    ["a partial month", "1", "1"],
    ["a month alone", "12", "12"],
    ["a month and one year digit", "123", "12/3"],
    ["nothing", "", ""],
  ])("keeps the first four digits for %s", (_case, value, expected) => {
    expect(formatExpiry(value)).toBe(expected);
  });
});
