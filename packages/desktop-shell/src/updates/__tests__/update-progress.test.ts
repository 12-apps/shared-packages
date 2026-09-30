import { describe, expect, it } from "vitest";

import { progressed, type UpdateState } from "../manager";

const DOWNLOADING: UpdateState = { kind: "downloading", version: "0.1.56", percent: null };

/**
 * The bar is drawn from this state, so every case here is a way the bar lies:
 * a version that vanishes mid-download, a fill that jumps backwards, a value
 * Chromium renders as empty.
 */
describe("folding a download-progress event into the state", () => {
  it("keeps the version, which the progress payload does not carry", () => {
    const next = progressed(DOWNLOADING, 42);

    expect(next).toEqual({ kind: "downloading", version: "0.1.56", percent: 42 });
  });

  it("replaces an earlier percent rather than accumulating", () => {
    const next = progressed({ ...DOWNLOADING, percent: 10 }, 55);

    expect(next).toEqual({ kind: "downloading", version: "0.1.56", percent: 55 });
  });

  it("ignores progress once the download is no longer the state", () => {
    // `update-downloaded` and a last `download-progress` race; rebuilding a
    // downloading state here would put the window back into a finished job.
    const ready: UpdateState = { kind: "ready", version: "0.1.56" };

    expect(progressed(ready, 99)).toBe(ready);
    expect(progressed({ kind: "failed" }, 50)).toEqual({ kind: "failed" });
    expect(progressed({ kind: "idle" }, 50)).toEqual({ kind: "idle" });
  });

  it("holds the last good value instead of showing a number it cannot draw", () => {
    // NaN through a <progress> value renders EMPTY, which reads as 0% — a
    // download that appears to start over.
    const at30: UpdateState = { ...DOWNLOADING, percent: 30 };

    expect(progressed(at30, Number.NaN)).toBe(at30);
    expect(progressed(at30, Number.POSITIVE_INFINITY)).toBe(at30);
    expect(progressed(at30, undefined)).toBe(at30);
    expect(progressed(at30, "80")).toBe(at30);
  });

  it("clamps an overshoot, which draws as empty rather than full", () => {
    expect(progressed(DOWNLOADING, 100.4)).toMatchObject({ percent: 100 });
    expect(progressed(DOWNLOADING, -3)).toMatchObject({ percent: 0 });
  });
});
