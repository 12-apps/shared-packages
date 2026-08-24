import { assertLocaleParity } from "@12-apps/i18n/testing";
import { describe, expect, it } from "vitest";

import { EVENTS_MESSAGES } from "../locales";

/**
 * `tsc` already refuses a MISSING key — both packs are typed against
 * `EventsMessages`. This covers the three drifts it cannot see: an optional key
 * present in one locale only, a nested object stubbed `{}`, and an
 * interpolating function whose translation dropped its argument.
 *
 * `@12-apps/i18n` is a devDependency and this file never ships (`files` excludes
 * `__tests__`), so the package keeps no runtime dependency on it.
 */
describe("the locale pack", () => {
  it("speaks both languages the same way", () => {
    assertLocaleParity("EVENTS_MESSAGES", EVENTS_MESSAGES);
  });

  it("keeps the rejected name in the unknown-topic sentence, in both", () => {
    // The name has to reach the reader in either language: it is the only clue
    // a legitimate caller gets about which entry of `?topics=` was refused.
    expect(EVENTS_MESSAGES["pt-BR"].unknownTopic("orders")).toContain("orders");
    expect(EVENTS_MESSAGES["en-US"].unknownTopic("orders")).toContain("orders");
  });
});
