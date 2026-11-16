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

  it("exports the support ladder, its MCP tool source and its typed error", () => {
    expect(typeof entry.createSupportLadder).toBe("function");
    expect(typeof entry.mcpTools).toBe("function");
    expect(entry.WITH_PERSON).toBe("person");
    expect(entry.ESCALATE_TOOL).toBe("escalate");
    expect(new entry.SupportLadderError("empty_tiers", "x")).toBeInstanceOf(entry.InvalidRequestError);
  });
});
