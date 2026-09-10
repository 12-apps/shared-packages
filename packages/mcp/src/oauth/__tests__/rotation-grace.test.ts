import { describe, expect, it } from "vitest";

import { openSuccessor, sealSuccessor } from "../rotation-grace";

/**
 * The sealed successor, on its own.
 *
 * `token.test.ts` proves what the grace window DOES to a grant; these cases prove
 * the property the window rests on: the successor is recoverable by a caller
 * holding the parent, and by nothing else — not by the database, not by a
 * neighbouring token, and not by anyone who edits the row.
 */

const PARENT = "a".repeat(64);
const SUCCESSOR = "b".repeat(64);
const OTHER_PARENT = "c".repeat(64);

/** A fixed deadline: none of these cases reads the clock, only the sealed value. */
const FUTURE = Date.parse("2026-09-10T12:01:00.000Z");

describe("sealSuccessor / openSuccessor", () => {
  it("round-trips the successor and its deadline for the parent that sealed it", () => {
    const seal = sealSuccessor(PARENT, SUCCESSOR, FUTURE);

    expect(openSuccessor(PARENT, seal)).toEqual({
      successor: SUCCESSOR,
      graceUntil: FUTURE,
    });
  });

  it("does not leak the plaintext into the sealed blob", () => {
    // The whole point: this string is what lands in the database column.
    const seal = sealSuccessor(PARENT, SUCCESSOR, FUTURE);

    expect(seal).not.toContain(SUCCESSOR);
    expect(seal).not.toContain(PARENT);
  });

  it("refuses a different parent", () => {
    // The key is derived from the parent, so holding a sibling token — or the
    // whole table — is not holding the key.
    const seal = sealSuccessor(PARENT, SUCCESSOR, FUTURE);

    expect(openSuccessor(OTHER_PARENT, seal)).toBeNull();
  });

  it("uses a fresh nonce, so the same input never seals to the same blob", () => {
    // Equal ciphertexts would tell an observer that two rotations carried the
    // same token, and would reuse an AES-GCM nonce under one key.
    expect(sealSuccessor(PARENT, SUCCESSOR, FUTURE)).not.toBe(
      sealSuccessor(PARENT, SUCCESSOR, FUTURE),
    );
  });

  it("refuses a tampered ciphertext", () => {
    const [version, iv, tag, body] = sealSuccessor(PARENT, SUCCESSOR, FUTURE).split(".");
    const flipped = Buffer.from(body ?? "", "base64url");
    flipped[0] = (flipped[0] ?? 0) ^ 0xff;

    expect(
      openSuccessor(PARENT, [version, iv, tag, flipped.toString("base64url")].join(".")),
    ).toBeNull();
  });

  it("refuses a tampered authentication tag", () => {
    const [version, iv, tag, body] = sealSuccessor(PARENT, SUCCESSOR, FUTURE).split(".");
    const flipped = Buffer.from(tag ?? "", "base64url");
    flipped[0] = (flipped[0] ?? 0) ^ 0xff;

    expect(
      openSuccessor(PARENT, [version, iv, flipped.toString("base64url"), body].join(".")),
    ).toBeNull();
  });

  it("refuses a deadline swapped in from another seal", () => {
    // The deadline is sealed INSIDE the blob rather than kept in its own column,
    // so extending the window means forging the tag. Splicing the body of a
    // longer-lived seal onto this one's nonce and tag does not open.
    const near = sealSuccessor(PARENT, SUCCESSOR, FUTURE).split(".");
    const far = sealSuccessor(PARENT, SUCCESSOR, FUTURE + 3_600_000).split(".");

    expect(
      openSuccessor(PARENT, [near[0], near[1], near[2], far[3]].join(".")),
    ).toBeNull();
  });

  it.each([
    ["empty", ""],
    ["not four parts", "v1.aaa.bbb"],
    ["an unknown version", "v2.aaa.bbb.ccc"],
    ["a short nonce", "v1.YWE.YmI.Y2M"],
    ["not base64url at all", "v1.!!!.???.***"],
  ])("returns null for a malformed seal: %s", (_label, seal) => {
    // Every malformed case is `null` rather than a throw: the caller treats null
    // as "no grace applies" and falls through to the replay rule, so a bad blob
    // costs a client its retry and never a 500.
    expect(openSuccessor(PARENT, seal)).toBeNull();
  });
});
