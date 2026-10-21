// @vitest-environment jsdom
/**
 * FUT-3711 (balcão UI review) — a list row keeps 12px above and below its
 * words, a 48px floor, and its radio on the TITLE's line: a hint that wraps
 * (Pix's at 320px) neither touches the row's border nor drags the radio down.
 * jsdom does not lay out, so the row's own rules are read as written; the
 * harness measures the drawn rows.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { cleanup, screen } from "@testing-library/react";

import { onPageStore, renderList, stubClient } from "./list-harness";

/** Every rule emotion wrote, whitespace stripped. */
function styleText(): string {
  return Array.from(document.querySelectorAll("style"))
    .map((style) => style.textContent ?? "")
    .join("")
    .replace(/\s+/g, "");
}

/** The declarations of the rule for `element`'s emotion class. */
function ruleOf(element: Element): string {
  const name = Array.from(element.classList).find((entry) => entry.startsWith("css-"));
  if (!name) throw new Error("no emotion class");
  const found = new RegExp(`\\.${name}\\{([^}]*)\\}`).exec(styleText());
  return found?.[1] ?? "";
}

beforeEach(() => window.sessionStorage.clear());
afterEach(cleanup);

describe("a list row", () => {
  it("pads its words 12px top and bottom over a 48px floor, the radio on the title's line", async () => {
    renderList({ config: onPageStore(), client: stubClient() });
    const radio = await screen.findByTestId("list-option-PIX-radio");
    const label = radio.closest("label");
    if (!label) throw new Error("the row's label");
    const rule = ruleOf(label);
    expect(rule).toContain("align-items:flex-start");
    expect(rule).toContain("min-height:48px");
    expect(rule).toContain("padding-top:12px");
    expect(rule).toContain("padding-bottom:12px");
    expect(rule).toContain("box-sizing:border-box");
    const radioRoot = radio.closest(".MuiRadio-root");
    if (!radioRoot) throw new Error("the radio's root");
    expect(ruleOf(radioRoot)).toContain("margin-top:2px");
  });
});
