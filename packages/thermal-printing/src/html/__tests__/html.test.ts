import { describe, expect, it } from "vitest";

import { renderTicketHtml } from "../index";
import type { TicketLine } from "../../index";

/**
 * The document a CABLE printer prints.
 *
 * It exists because a USB printer has no address; it is built from the same
 * `TicketLine[]` the ESC/POS encoder takes, so a store that swaps a USB printer
 * for a Wi-Fi one gets the same ticket rather than a second layout.
 */

const line = (text: string, emphasis: TicketLine["emphasis"] = "normal"): TicketLine => ({
  text,
  align: "left",
  emphasis,
});

describe("renderTicketHtml", () => {
  it("sizes the page in CHARACTERS, so a driver's margins cannot rewrap it", () => {
    expect(renderTicketHtml([line("ok")], 58)).toContain("width:32ch");
    expect(renderTicketHtml([line("ok")], 80)).toContain("width:48ch");
  });

  it("kills the page margin a driver would otherwise add to a receipt roll", () => {
    expect(renderTicketHtml([line("ok")], 80)).toContain("@page{margin:0}");
  });

  it("escapes a store-authored dish name rather than letting it open a tag", () => {
    const html = renderTicketHtml([line('Refri <2L> & "gelado"')], 80);

    expect(html).toContain("Refri &lt;2L&gt; &amp; &quot;gelado&quot;");
    expect(html).not.toContain("<2L>");
  });

  it("never lets a product name become markup in the tab that prints it", () => {
    const html = renderTicketHtml([line("<script>alert(1)</script>")], 80);

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("keeps a blank line occupying one", () => {
    expect(renderTicketHtml([line("")], 80)).toContain("&nbsp;");
  });

  it("matches the ESC/POS encoder: double height, never double width", () => {
    const html = renderTicketHtml([line("MESA 12", "double")], 80);

    expect(html).toContain("font-size:2em");
  });
});
