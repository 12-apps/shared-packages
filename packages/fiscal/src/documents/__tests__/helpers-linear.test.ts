import { describe, expect, it, vi } from "vitest";
import { accessKeyOf } from "../../danfe/xml";
import { drawKeyCode, trimEnd, xmlKeys } from "../helpers";

const KEY = "35261112345678000195650010000000011000000019";
const NFE_XML = `<NFe><infNFe versao="4.00" Id="NFe${KEY}"><ide/></infNFe></NFe>`;

/**
 * The time a linear helper gets for its long input. It is the case's own
 * timeout, which vitest enforces on a synchronous case too: a quadratic helper
 * takes seconds on these inputs, a linear one a few milliseconds.
 */
const LINEAR_BUDGET_MS = 200;
/** A 200 000-character run of the trimmed character, between two others. */
const LONG_PADDING_RUN = `x${"=".repeat(200_000)}y`;
/** 50 000 unclosed `<infNFe` tags: the input a backtracking pattern chokes on. */
const UNCLOSED_TAGS = "<infNFe".repeat(50_000);

describe("helpers flagged by CodeQL", () => {
  it("trims only the trailing run, in linear time on a long run", () => {
    expect(trimEnd("ab==", "=")).toBe("ab");
    expect(trimEnd("a=b", "=")).toBe("a=b");
    expect(trimEnd(LONG_PADDING_RUN, "=")).toHaveLength(200_002);
  }, LINEAR_BUDGET_MS);

  it("keys a digest url-safe and without padding", () => {
    expect(xmlKeys.signedByDigest(KEY, "a+b/c==")).toBe(`fiscal/${KEY}/signed-a-b_c.xml`);
  });

  it("reads the access key only from the first infNFe open tag", () => {
    expect(accessKeyOf(NFE_XML)).toBe(KEY);
    expect(accessKeyOf("<NFe/>")).toBeNull();
    expect(accessKeyOf(UNCLOSED_TAGS)).toBeNull();
  }, LINEAR_BUDGET_MS);

  it("redraws a value that would bias the code, and never returns the number's own digits", () => {
    const values = [4_294_967_295, 1, 123];
    const spy = vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(<T extends ArrayBufferView>(array: T) => {
      (array as unknown as Uint32Array)[0] = values.shift() ?? 0;
      return array;
    });
    expect(drawKeyCode(1)).toBe("00000123");
    spy.mockRestore();
  });
});
