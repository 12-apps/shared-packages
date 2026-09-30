/**
 * Performance spans leave the device with no store identity in them (FUT-2951).
 *
 * The fixture puts a store slug in EVERY place a Web Vitals span can carry a
 * page: its name, the two segment-name attributes the SDK stamps on every
 * span, and the URL a vital attributes itself to. A scrub that covered the
 * name alone would pass a narrower test and still leak the slug.
 */
import { afterEach, describe, expect, it } from "vitest";

import { resetSpanTextScrubberForTests, scrubSpan, setSpanTextScrubber } from "../span-scrub";

const SLUG = "aliment-sabor";

/** A host's rule, as one adopter registers it: the first path segment is the tenant. */
const hideStore = (text: string): string => text.replace(/\/[^/?#]+/, "/:store");

function leakySpan() {
  return {
    name: `/${SLUG}/delivery`,
    attributes: {
      "sentry.transaction": `/${SLUG}/delivery`,
      "sentry.segment.name": `/${SLUG}/delivery`,
      "browser.web_vital.lcp.url": `https://paladira.app/${SLUG}/img/hero.webp?token=secret#x`,
      "url.full": `https://paladira.app/${SLUG}/delivery`,
      "browser.web_vital.lcp.value": 1234,
      "sentry.op": "ui.webvital.lcp",
    },
  };
}

afterEach(() => resetSpanTextScrubberForTests());

describe("scrubSpan", () => {
  it("removes the store from the name, both segment attributes and every URL attribute", () => {
    setSpanTextScrubber(hideStore);
    const scrubbed = scrubSpan(leakySpan());

    expect(JSON.stringify(scrubbed)).not.toContain(SLUG);
    expect(scrubbed.name).toBe("/:store/delivery");
    expect(scrubbed.attributes["sentry.transaction"]).toBe("/:store/delivery");
    expect(scrubbed.attributes["sentry.segment.name"]).toBe("/:store/delivery");
  });

  it("drops a URL's query and fragment, where tokens end up", () => {
    setSpanTextScrubber(hideStore);
    const url = scrubSpan(leakySpan()).attributes["browser.web_vital.lcp.url"] as string;
    expect(url).not.toContain("secret");
    expect(url).not.toContain("#x");
  });

  it("leaves the measurement and every non-page attribute alone", () => {
    setSpanTextScrubber(hideStore);
    const scrubbed = scrubSpan(leakySpan());
    expect(scrubbed.attributes["browser.web_vital.lcp.value"]).toBe(1234);
    expect(scrubbed.attributes["sentry.op"]).toBe("ui.webvital.lcp");
  });

  it("without a host rule it still strips queries, and changes nothing else", () => {
    const scrubbed = scrubSpan(leakySpan());
    expect(scrubbed.name).toBe(`/${SLUG}/delivery`);
    expect(scrubbed.attributes["browser.web_vital.lcp.url"]).not.toContain("secret");
  });

  it("tolerates a span with no attributes", () => {
    setSpanTextScrubber(hideStore);
    expect(scrubSpan({ name: `/${SLUG}` })).toEqual({ name: "/:store", attributes: undefined });
  });
});
