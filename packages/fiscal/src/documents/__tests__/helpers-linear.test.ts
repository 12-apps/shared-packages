import { describe, expect, it, vi } from "vitest";
import { accessKeyOf } from "../../danfe/xml";
import { drawKeyCode, trimEnd, xmlKeys } from "../helpers";

const KEY = "35261112345678000195650010000000011000000019";

describe("helpers flagged by CodeQL", () => {
  it("trims only the trailing run, in linear time on a long run", () => {
    expect(trimEnd("ab==", "=")).toBe("ab");
    expect(trimEnd("a=b", "=")).toBe("a=b");
    const started = performance.now();
    expect(trimEnd(`x${"=".repeat(200_000)}y`, "=")).toHaveLength(200_002);
    expect(performance.now() - started).toBeLessThan(200);
  });

  it("keys a digest url-safe and without padding", () => {
    expect(xmlKeys.signedByDigest(KEY, "a+b/c==")).toBe(`fiscal/${KEY}/signed-a-b_c.xml`);
  });

  it("reads the access key only from the first infNFe open tag", () => {
    expect(accessKeyOf(`<NFe><infNFe versao="4.00" Id="NFe${KEY}"><ide/></infNFe></NFe>`)).toBe(KEY);
    expect(accessKeyOf("<NFe/>")).toBeNull();
    const started = performance.now();
    expect(accessKeyOf("<infNFe".repeat(50_000))).toBeNull();
    expect(performance.now() - started).toBeLessThan(200);
  });

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
