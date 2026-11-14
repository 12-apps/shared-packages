import { createHash, createHmac, randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { decodeBase64, utf8 } from "../encoding";
import { hmacSha256, sha256, toHex } from "../hmac-sha256";

/**
 * The terminal signs with the JavaScript HMAC and the station may verify with
 * `node:crypto`: they must agree byte for byte, or every message is refused.
 */
describe("the JavaScript HMAC-SHA256", () => {
  it("matches RFC 4231 test case 2", () => {
    expect(toHex(hmacSha256(utf8("Jefe"), utf8("what do ya want for nothing?")))).toBe(
      "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
    );
  });

  it("matches RFC 4231 test case 6 (a key longer than the block is hashed first)", () => {
    expect(toHex(hmacSha256(new Uint8Array(131).fill(0xaa), utf8("Test Using Larger Than Block-Size Key - Hash Key First")))).toBe(
      "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54",
    );
  });

  it("agrees with node:crypto on SHA-256 and HMAC for every length across the block boundaries", () => {
    for (let length = 0; length < 200; length++) {
      const data = randomBytes(length);
      const key = randomBytes(length % 90);
      expect(toHex(sha256(data))).toBe(createHash("sha256").update(data).digest("hex"));
      expect(toHex(hmacSha256(key, data))).toBe(createHmac("sha256", key).update(data).digest("hex"));
    }
  });
});

describe("base64", () => {
  it("decodes what Node encodes, padded or not", () => {
    for (let length = 0; length < 40; length++) {
      const bytes = randomBytes(length);
      const encoded = bytes.toString("base64");
      expect(Array.from(decodeBase64(encoded) ?? [])).toEqual(Array.from(bytes));
      expect(Array.from(decodeBase64(encoded.replace(/=+$/, "")) ?? [])).toEqual(Array.from(bytes));
    }
  });

  it("decodes the base64url a host mints the link secret in, padded or not", () => {
    for (let length = 1; length < 40; length++) {
      const bytes = randomBytes(length);
      const encoded = bytes.toString("base64url");
      expect(Array.from(decodeBase64(encoded) ?? [])).toEqual(Array.from(bytes));
    }
    // 0xfb 0xff → "-_8" in base64url, "+/8" in base64: the same bytes, either alphabet.
    expect(Array.from(decodeBase64("-_8") ?? [])).toEqual([0xfb, 0xff]);
    expect(Array.from(decodeBase64("+/8=") ?? [])).toEqual([0xfb, 0xff]);
  });

  it("refuses a text that mixes the two alphabets", () => {
    expect(decodeBase64("-/8")).toBeNull();
    expect(decodeBase64("+_8")).toBeNull();
  });

  it("refuses what is not base64", () => {
    expect(decodeBase64("a")).toBeNull();
    expect(decodeBase64("ab$d")).toBeNull();
    expect(decodeBase64("ab===")).toBeNull();
  });

  it("is strict, so one secret has one spelling", () => {
    // Empty is no secret at all.
    expect(decodeBase64("")).toBeNull();
    expect(decodeBase64("==")).toBeNull();
    // With `=`, the padded length is a multiple of 4.
    expect(decodeBase64("QQ=")).toBeNull();
    expect(decodeBase64("QUI==")).toBeNull();
    expect(Array.from(decodeBase64("QQ==") ?? [])).toEqual([0x41]);
    expect(Array.from(decodeBase64("QUI=") ?? [])).toEqual([0x41, 0x42]);
    // The unused low bits of the last character are zero.
    expect(decodeBase64("QR==")).toBeNull();
    expect(decodeBase64("QR")).toBeNull();
    expect(decodeBase64("QUJ=")).toBeNull();
    expect(decodeBase64("QUJ")).toBeNull();
    expect(Array.from(decodeBase64("QUI") ?? [])).toEqual([0x41, 0x42]);
  });
});
