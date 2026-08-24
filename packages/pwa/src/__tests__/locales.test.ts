import { assertLocaleParity } from "@12-apps/i18n/testing";
import { describe, expect, it } from "vitest";

import { PWA_MESSAGES } from "../locales";

/**
 * `tsc` already refuses a MISSING key — both packs are typed against
 * `PwaMessages`. This covers the drifts it cannot see: an optional key in one
 * locale only, a nested object stubbed empty, and a translation that dropped an
 * interpolated argument.
 *
 * `@12-apps/i18n` is a devDependency and this file never ships (`files`
 * excludes `__tests__`), so the package keeps no runtime dependency on it.
 */
describe("the locale pack", () => {
  it("speaks both languages the same way", () => {
    assertLocaleParity("PWA_MESSAGES", PWA_MESSAGES);
  });

  it("carries the host's own name into every prompt, in both", () => {
    // `what` is a brand, not a word: it is interpolated and never translated.
    for (const messages of Object.values(PWA_MESSAGES)) {
      expect(messages.promptHandheld("Acme")).toContain("Acme");
      expect(messages.promptDesktop("Acme")).toContain("Acme");
      expect(messages.iosBenefit("Acme")).toContain("Acme");
    }
  });
});
