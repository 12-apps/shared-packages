import { describe, expect, it } from "vitest";

import { CONTACT_KINDS, detectContactInfo, type ContactVocabulary } from "../core/contact";

/**
 * The contact-info filter: a role it binds must not pass a way to be reached
 * outside the thread, however the number or address is dressed up. Generic
 * patterns here; the host's words (spelled digits, app names) widen them.
 */

const ALL = CONTACT_KINDS;

/** A host's dodge-words, as a host would pass them — data for the test, not package vocabulary. */
const VOCABULARY: ContactVocabulary = {
  numberWords: { zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9" },
  atWords: ["at"],
  dotWords: ["dot"],
  extraPatterns: [/\bwhats ?app\b/, /\binsta(gram)?\b/],
};

describe("detectContactInfo", () => {
  it.each([
    ["call me 11987654321", "phone"],
    ["(11) 98765-4321", "phone"],
    ["1 1 9 8 7 6 5 4 3 2 1", "phone"],
    ["+55 11 9.8765.4321", "phone"],
    ["me at ana.souza@example.com", "email"],
    ["ana.souza @ example . com", "email"],
    ["see https://example.com/x", "url"],
    ["www.example.org", "url"],
    ["example.com.br/promo", "url"],
    ["follow @ana_souza", "handle"],
  ])("finds %s as %s", (text, kind) => {
    expect(detectContactInfo(text, ALL)).toContain(kind);
  });

  it.each([
    "I am at the door",
    "Two minutes away",
    "Gate 12, block B, apartment 302",
    "Change for 50.00 please",
    "Your total is 37.90",
    "OK, thanks!",
  ])("lets an ordinary line through: %s", (text) => {
    expect(detectContactInfo(text, ALL)).toEqual([]);
  });

  it("checks only the kinds the role blocks", () => {
    expect(detectContactInfo("11987654321", ["email"])).toEqual([]);
    expect(detectContactInfo("anything at all", [])).toEqual([]);
  });

  it("reads the host's words: spelled digits, words for @ and ., app names", () => {
    expect(detectContactInfo("one one nine eight seven six five four three two", ["phone"], VOCABULARY)).toEqual(["phone"]);
    expect(detectContactInfo("ana at example dot com", ["email"], VOCABULARY)).toEqual(["email"]);
    expect(detectContactInfo("add me on WhatsApp", ["handle"], VOCABULARY)).toEqual(["handle"]);
    expect(detectContactInfo("my INSTA is cool", ["handle"], VOCABULARY)).toEqual(["handle"]);
  });

  it("ignores accents and case when folding the host's words", () => {
    const accented: ContactVocabulary = { numberWords: { "nóve": "9" } };
    expect(detectContactInfo("NOVE nove nove nove nove nove nove nove", ["phone"], accented)).toEqual(["phone"]);
  });
});
