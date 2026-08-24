import { assertLocaleParity } from "@12-apps/i18n/testing";
import { describe, expect, it } from "vitest";

import {
  AI_CAPABILITIES,
  AI_CONNECT_PROMPT,
  AI_HOST_GUIDES,
  AI_PERMISSION_MODEL,
} from "../locales";
import { MCP_AI_COPY } from "../react/locales";

/**
 * `tsc` already refuses a MISSING key. This covers the three drifts it cannot
 * see, and the properties of this surface that a translation could break
 * without breaking a type — most of which come from the guides being DATA as
 * much as copy.
 *
 * The two FUNCTION packs are asserted on what they return, with a sample
 * argument: comparing the functions themselves would only prove both take one
 * parameter, and every missing step inside would pass.
 *
 * `@12-apps/i18n` is a devDependency and this file never ships.
 */
const PROMPT_SPEC = {
  announceTool: "announceAiConnection",
  probeTool: "listProducts",
  probeSubject: "the catalog",
  identifierName: "store slug",
};

describe("the locale packs", () => {
  it("speak both languages the same way", () => {
    assertLocaleParity("MCP_AI_COPY", MCP_AI_COPY);
    assertLocaleParity("AI_CAPABILITIES", AI_CAPABILITIES);
    assertLocaleParity("AI_PERMISSION_MODEL", AI_PERMISSION_MODEL);
    assertLocaleParity("AI_HOST_GUIDES", {
      "pt-BR": AI_HOST_GUIDES["pt-BR"]("Acme"),
      "en-US": AI_HOST_GUIDES["en-US"]("Acme"),
    });
  });

  it("offers the same assistants, keyed the same way, in both", () => {
    // `id` and `brand` are the package's own keys — the component matches its
    // icons off them — so they must NOT vary by language.
    const ids = (guides: readonly { id: string; brand: string }[]) =>
      guides.map((guide) => `${guide.id}:${guide.brand}`);
    expect(ids(AI_HOST_GUIDES["en-US"]("Acme"))).toEqual(ids(AI_HOST_GUIDES["pt-BR"]("Acme")));
    expect(AI_CAPABILITIES["en-US"].map((c) => c.id)).toEqual(
      AI_CAPABILITIES["pt-BR"].map((c) => c.id),
    );
  });

  it("points both languages at the same vendor documentation", () => {
    const urls = (guides: readonly { docs?: { url: string } }[]) =>
      guides.map((guide) => guide.docs?.url);
    expect(urls(AI_HOST_GUIDES["en-US"]("Acme"))).toEqual(urls(AI_HOST_GUIDES["pt-BR"]("Acme")));
  });

  it("names the platform in the button the owner is told to click", () => {
    // It once named one tenant of one deployment, so every other adopter told
    // its owners to click a button that does not exist.
    for (const guides of Object.values(AI_HOST_GUIDES)) {
      const chatgpt = guides("Acme").find((guide) => guide.id === "chatgpt");
      expect(chatgpt?.steps.join(" ")).toContain("Acme");
    }
  });

  it("interpolates the host's own tool names into the connect prompt", () => {
    // The assistant has to call them by the name they are registered under; a
    // translated verb here is a prompt that does nothing.
    for (const prompt of Object.values(AI_CONNECT_PROMPT)) {
      const text = prompt(PROMPT_SPEC);
      expect(text).toContain(PROMPT_SPEC.announceTool);
      expect(text).toContain(PROMPT_SPEC.probeTool);
      expect(text).toContain(PROMPT_SPEC.identifierName);
    }
  });
});
