import { assertLocaleParity } from "@12-apps/i18n/testing";
import { describe, expect, it } from "vitest";

import { FEATURE_FLAGS_COPY } from "../react/locales";
import { FEATURE_FLAGS_SERVER_COPY } from "../server/locales";

/**
 * `tsc` already refuses a MISSING key — every pack is typed against its
 * interface. This covers the drifts it cannot see, and one more that is
 * specific to this package: its copy interpolates with `{token}` strings rather
 * than functions, so a renamed or dropped token is a sentence that renders its
 * own placeholder to a user and nothing else notices.
 *
 * `@12-apps/i18n` is a devDependency and this file never ships.
 */
const TOKENS: Record<string, readonly string[]> = {
  pageOf: ["{page}", "{pages}", "{total}"],
  tally: ["{enabled}", "{total}"],
};

describe("the locale packs", () => {
  it("speak both languages the same way", () => {
    assertLocaleParity("FEATURE_FLAGS_COPY", FEATURE_FLAGS_COPY);
    assertLocaleParity("FEATURE_FLAGS_SERVER_COPY", FEATURE_FLAGS_SERVER_COPY);
  });

  it("keeps every substitution token the surface fills in", () => {
    for (const copy of Object.values(FEATURE_FLAGS_COPY)) {
      for (const [key, tokens] of Object.entries(TOKENS)) {
        for (const token of tokens) {
          expect(copy[key as keyof typeof copy]).toContain(token);
        }
      }
    }
  });
});
