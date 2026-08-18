import { describe, expect, it } from "vitest";

import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  checkPasswordPolicy,
  dummyVerify,
  hashPassword,
  isPasswordAcceptable,
  needsRehash,
  verifyPassword,
} from "../password";

describe("hashPassword / verifyPassword", () => {
  it("verifies a password against its own hash", async () => {
    const hash = await hashPassword("correct horse battery 9");
    await expect(verifyPassword("correct horse battery 9", hash)).resolves.toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("correct horse battery 9");
    await expect(verifyPassword("correct horse battery 8", hash)).resolves.toBe(false);
  });

  it("salts, so the same password hashes differently every time", async () => {
    const [a, b] = await Promise.all([hashPassword("s3nha boa"), hashPassword("s3nha boa")]);
    expect(a).not.toBe(b);
    await expect(verifyPassword("s3nha boa", a)).resolves.toBe(true);
    await expect(verifyPassword("s3nha boa", b)).resolves.toBe(true);
  });

  it("records its own parameters in the stored string", async () => {
    const hash = await hashPassword("s3nha boa");
    const [algorithm, cost, blockSize, parallelism, salt, derived] = hash.split("$");
    expect(algorithm).toBe("scrypt");
    expect(Number(cost)).toBeGreaterThanOrEqual(16384);
    expect(Number(blockSize)).toBe(8);
    expect(Number(parallelism)).toBe(1);
    expect(salt).toBeTruthy();
    expect(derived).toBeTruthy();
  });

  it("normalises unicode, so the same passphrase typed two ways still verifies", async () => {
    // "café" with a combining accent vs. the precomposed character. Two byte
    // strings, one passphrase — a user who set it on one OS must not be locked
    // out on another.
    const combining = "café forte 1";
    const precomposed = "café forte 1";
    expect(combining).not.toBe(precomposed);
    const hash = await hashPassword(combining);
    await expect(verifyPassword(precomposed, hash)).resolves.toBe(true);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty", ""],
    ["not ours", "bcrypt$2b$10$abcdef"],
    ["truncated", "scrypt$16384$8$1$onlyfivefields"],
    ["non-numeric cost", "scrypt$abc$8$1$c2FsdA==$aGFzaA=="],
  ])("returns false for a %s stored value rather than throwing", async (_label, stored) => {
    await expect(verifyPassword("anything", stored)).resolves.toBe(false);
  });

  it("does not confuse two hashes of different derived lengths", async () => {
    const hash = await hashPassword("s3nha boa");
    const [algorithm, cost, blockSize, parallelism, salt] = hash.split("$");
    const short = [algorithm, cost, blockSize, parallelism, salt, "c2hvcnQ="].join("$");
    await expect(verifyPassword("s3nha boa", short)).resolves.toBe(false);
  });
});

describe("dummyVerify", () => {
  it("always answers false, having done the work", async () => {
    await expect(dummyVerify()).resolves.toBe(false);
  });
});

describe("needsRehash", () => {
  it("is false for a hash written at the current parameters", async () => {
    expect(needsRehash(await hashPassword("s3nha boa"))).toBe(false);
  });

  it("is true for a hash written at a lower cost", async () => {
    const hash = await hashPassword("s3nha boa");
    const parts = hash.split("$");
    parts[1] = "1024";
    expect(needsRehash(parts.join("$"))).toBe(true);
  });

  it("is true for anything unparseable, so a foreign hash gets replaced", () => {
    expect(needsRehash("bcrypt$2b$10$abcdef")).toBe(true);
  });

  it("is false when there is no hash at all — nothing to upgrade", () => {
    expect(needsRehash(null)).toBe(false);
    expect(needsRehash(undefined)).toBe(false);
  });
});

describe("checkPasswordPolicy", () => {
  it("accepts a reasonable password", () => {
    expect(checkPasswordPolicy("boa senha 42")).toEqual([]);
    expect(isPasswordAcceptable("boa senha 42")).toBe(true);
  });

  it("reports every violation at once rather than the first", () => {
    expect(checkPasswordPolicy("ab")).toEqual(["too-short", "needs-number"]);
  });

  it("enforces the length bounds", () => {
    expect(checkPasswordPolicy("a1".repeat(MIN_PASSWORD_LENGTH / 2 - 1))).toContain("too-short");
    expect(checkPasswordPolicy(`a1${"x".repeat(MAX_PASSWORD_LENGTH)}`)).toContain("too-long");
  });

  it("requires a letter and a digit by default, and can be told not to", () => {
    expect(checkPasswordPolicy("123456789")).toContain("needs-letter");
    expect(checkPasswordPolicy("abcdefghi")).toContain("needs-number");
    expect(checkPasswordPolicy("abcdefghi", { requireNumber: false })).toEqual([]);
  });

  it("counts a non-latin letter as a letter", () => {
    expect(checkPasswordPolicy("сильный1")).toEqual([]);
  });

  it("refuses the obvious answers to its own rules", () => {
    expect(checkPasswordPolicy("password1")).toEqual(["too-common"]);
    expect(checkPasswordPolicy("Password123")).toEqual(["too-common"]);
  });

  it("matches the deny list past case and surrounding whitespace", () => {
    // Capitalising or padding a common password does not make it a new one.
    expect(checkPasswordPolicy("SENHA123")).toEqual(["too-common"]);
    expect(checkPasswordPolicy("  senha123  ")).toEqual(["too-common"]);
  });

  it("refuses a host's own deny-list entries, case-insensitively", () => {
    expect(checkPasswordPolicy("FuturePay1", { denyList: ["futurepay1"] })).toEqual([
      "too-common",
    ]);
  });
});
