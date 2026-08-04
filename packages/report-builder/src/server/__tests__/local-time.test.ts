import { describe, expect, it } from "vitest";

import { dayOfWeekSaoPaulo, hourOfDaySaoPaulo } from "../local-time";

/**
 * America/Sao_Paulo is UTC-3 with no DST (abolished in 2019), so the
 * merchant-local derivations shift instants back three hours — including
 * across day boundaries, which is exactly the case UTC bucketing would get
 * wrong for "horário de pico".
 */
describe("hourOfDaySaoPaulo", () => {
  it("shifts UTC instants to the local clock", () => {
    expect(hourOfDaySaoPaulo(new Date("2026-07-25T12:00:00Z"))).toBe("09");
  });

  it("crosses the day boundary backwards", () => {
    // 02:30 UTC Saturday is 23:30 FRIDAY in São Paulo.
    expect(hourOfDaySaoPaulo(new Date("2026-07-25T02:30:00Z"))).toBe("23");
  });

  it("renders local midnight as 00, never 24", () => {
    expect(hourOfDaySaoPaulo(new Date("2026-07-25T03:00:00Z"))).toBe("00");
  });
});

describe("dayOfWeekSaoPaulo", () => {
  it("labels local weekdays in ISO order with pt-BR names", () => {
    // 2026-07-25 12:00Z is Saturday local.
    expect(dayOfWeekSaoPaulo(new Date("2026-07-25T12:00:00Z"))).toBe("6-sáb");
  });

  it("attributes early-UTC instants to the previous local day", () => {
    // 02:30 UTC Saturday is still Friday in São Paulo.
    expect(dayOfWeekSaoPaulo(new Date("2026-07-25T02:30:00Z"))).toBe("5-sex");
  });

  it("covers the whole week", () => {
    // 2026-07-20T12:00Z is a Monday.
    const labels = Array.from({ length: 7 }, (_, day) =>
      dayOfWeekSaoPaulo(new Date(Date.UTC(2026, 6, 20 + day, 12))),
    );
    expect(labels).toEqual(["1-seg", "2-ter", "3-qua", "4-qui", "5-sex", "6-sáb", "7-dom"]);
  });
});
