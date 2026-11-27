import { describe, expect, it } from "vitest";
import { createUranoParser } from "../urano";
import { captures, frame } from "./urano-captures";

describe("the Urano POP Light serial frame", () => {
  it("preserves integer net and tare grams across actual frames", () => {
    const parser = createUranoParser();
    const readings = Object.values(captures).flatMap((hex) => parser.push(frame(hex)));
    expect(readings.map(({ tareGrams, netGrams }) => [tareGrams, netGrams])).toEqual(
      [[0, 0], [0, 286], [286, 0], [286, 428], [0, 0]],
    );
    expect(readings[3]).toEqual({ tareGrams: 286, netGrams: 428, stable: "inferred", raw: frame(captures.second) });
  });

  it("reassembles a split frame and reads consecutive frames from the same chunk", () => {
    const parser = createUranoParser();
    const bytes = frame(captures.plate);
    for (let index = 0; index < bytes.length - 1; index += 32) {
      expect(parser.push(bytes.slice(index, Math.min(bytes.length - 1, index + 32)))).toHaveLength(0);
    }
    const combined = Uint8Array.of(...bytes.slice(-1), ...frame(captures.second));
    expect(parser.push(combined).map(({ netGrams }) => netGrams)).toEqual([286, 428]);
  });

  it("recovers from garbage and truncation before a new valid header", () => {
    const parser = createUranoParser();
    expect(parser.push(Uint8Array.of(3, 255, ...frame(captures.plate).slice(0, 60)))).toEqual([]);
    expect(parser.push(frame(captures.tared))).toMatchObject([{ netGrams: 0, tareGrams: 286 }]);
  });
});
