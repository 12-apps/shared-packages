import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DAY_RANGE_PRESETS,
  isPresetActive,
  presetsFor,
  resolvePreset,
} from "../data-views-range-presets";
import type { RangeFieldConfig, RangePreset } from "../data-views-types";

/** One default preset by id, so a test names the window it means. */
function preset(id: string): RangePreset {
  const found = DAY_RANGE_PRESETS.find((p) => p.id === id);
  if (!found) throw new Error(`no default day preset "${id}"`);
  return found;
}

/**
 * Freeze the clock at a LOCAL wall time. `vi.setSystemTime` takes an instant,
 * and constructing it from local Y/M/D parts is what makes these assertions
 * about the local calendar rather than about the runner's timezone.
 */
function freeze(year: number, month: number, day: number, hour = 12): void {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(year, month - 1, day, hour, 0, 0));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("the date filter's calendar presets", () => {
  it("resolves Hoje to today, both bounds, in the LOCAL calendar", () => {
    // 21:30 on the 6th is already the 7th in UTC for every Brazilian offset.
    // Formatting through toISOString() would hand back tomorrow — so "Hoje"
    // would quietly stop meaning today every evening.
    freeze(2026, 8, 6, 23);
    expect(resolvePreset(preset("hoje"))).toEqual({ min: "2026-08-06", max: "2026-08-06" });
  });

  it("resolves Ontem across a month boundary", () => {
    freeze(2026, 8, 1);
    expect(resolvePreset(preset("ontem"))).toEqual({ min: "2026-07-31", max: "2026-07-31" });
  });

  it("starts Esta semana on SUNDAY and spans seven days", () => {
    // 2026-08-06 is a Thursday; the Brazilian calendar these grids are read
    // against starts the week on domingo, not ISO-8601's Monday.
    freeze(2026, 8, 6);
    expect(resolvePreset(preset("semana"))).toEqual({ min: "2026-08-02", max: "2026-08-08" });
  });

  it("resolves Este mês to the WHOLE month, including a leap February", () => {
    freeze(2028, 2, 10);
    expect(resolvePreset(preset("mes"))).toEqual({ min: "2028-02-01", max: "2028-02-29" });
  });

  it("resolves Este ano to the whole year", () => {
    freeze(2026, 8, 6);
    expect(resolvePreset(preset("ano"))).toEqual({ min: "2026-01-01", max: "2026-12-31" });
  });

  it("resolves at CLICK time, not at module load", () => {
    // The reason `range` is a function. An admin tab left open overnight must
    // not go on filtering by the day it was opened.
    freeze(2026, 8, 6);
    const first = resolvePreset(preset("hoje"));
    vi.setSystemTime(new Date(2026, 7, 7, 12, 0, 0));
    expect(resolvePreset(preset("hoje"))).not.toEqual(first);
    expect(resolvePreset(preset("hoje"))).toEqual({ min: "2026-08-07", max: "2026-08-07" });
  });
});

describe("which presets a field offers", () => {
  const day: RangeFieldConfig<Record<string, unknown>> = {
    id: "data",
    label: "Data",
    kind: "day",
    accessor: () => "2026-08-06",
  };
  const number: RangeFieldConfig<Record<string, unknown>> = {
    id: "valor",
    label: "Valor",
    accessor: () => 10,
  };

  it("gives a day field the calendar defaults when it declares none", () => {
    expect(presetsFor(day).map((p) => p.label)).toEqual([
      "Hoje",
      "Ontem",
      "Esta semana",
      "Este mês",
      "Este ano",
    ]);
  });

  it("gives a NUMBER field none — what counts as a big order is the host's business", () => {
    expect(presetsFor(number)).toEqual([]);
  });

  it("honours an explicit empty list rather than falling back", () => {
    // A host suppressing the defaults is saying something; `presets: []` must
    // not read as "unset".
    expect(presetsFor({ ...day, presets: [] })).toEqual([]);
  });

  it("uses the host's own windows over the defaults", () => {
    const presets: RangePreset[] = [{ id: "acima", label: "Acima de R$ 500", range: { min: 500 } }];
    expect(presetsFor({ ...number, presets })).toEqual(presets);
    expect(presetsFor({ ...day, presets })).toEqual(presets);
  });
});

describe("whether a preset reads as applied", () => {
  const acima: RangePreset = { id: "acima", label: "Acima de R$ 500", range: { min: 500 } };

  it("matches the window it applies", () => {
    expect(isPresetActive(acima, { min: 500 })).toBe(true);
  });

  it("treats a missing bound and an undefined one as the same", () => {
    expect(isPresetActive(acima, { min: 500, max: undefined })).toBe(true);
  });

  it("does not match a window that merely overlaps", () => {
    expect(isPresetActive(acima, { min: 500, max: 900 })).toBe(false);
    expect(isPresetActive(acima, { min: 400 })).toBe(false);
  });

  it("matches a bound typed as a string against one declared as a number", () => {
    // The `De`/`Até` inputs hand back strings; the preset declares numbers.
    // Same window — the chip must not go dark because of how it was entered.
    expect(isPresetActive(acima, { min: "500" })).toBe(true);
  });

  it("re-resolves a time-dependent preset before comparing", () => {
    freeze(2026, 8, 6);
    expect(isPresetActive(preset("hoje"), { min: "2026-08-06", max: "2026-08-06" })).toBe(true);
    vi.setSystemTime(new Date(2026, 7, 7, 12, 0, 0));
    expect(isPresetActive(preset("hoje"), { min: "2026-08-06", max: "2026-08-06" })).toBe(false);
  });
});
