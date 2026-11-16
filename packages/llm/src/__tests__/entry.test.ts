import { describe, expect, it } from "vitest";

import * as entry from "../index";

describe("the published entry", () => {
  it("exports the xAI adapter like the other three providers (X1)", () => {
    expect(entry.XAI_PROVIDER).toBe("xai");
    expect(entry.xaiAdapter().id).toBe("xai");
    for (const name of ["anthropicAdapter", "openaiAdapter", "geminiAdapter", "xaiAdapter"] as const) {
      expect(typeof entry[name]).toBe("function");
    }
  });
});
