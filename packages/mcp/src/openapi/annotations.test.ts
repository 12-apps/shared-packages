import { describe, expect, it } from "vitest";

import { resolveToolAnnotations } from "./annotations";

/**
 * Composing a classification out of what the package knows and what the host
 * decided. The completeness property is unchanged — every served tool ends
 * with all four fields — and what these pin is WHO may supply each one, plus
 * that a gap is still a refusal rather than a silent default.
 */

const READS = { readOnly: true, destructive: false, openWorld: false };

describe("resolveToolAnnotations", () => {
  it("takes the package's behaviour and the host's title", () => {
    // The split the lifecycle factory ships: behaviour is the package's
    // knowledge, the label is host copy in the host's language.
    expect(resolveToolAnnotations("getSupplierVersions", READS, { title: "Histórico" })).toEqual({
      title: "Histórico",
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    });
  });

  it("lets the HOST win every field it states", () => {
    // A package's claim is a default, not a fact about this deployment: the
    // same endpoint can be read-only in one app and reach a vendor in another
    // (a host proxying its catalog reads). Inverting this would let a version
    // bump silently re-classify a tool an operator had already audited.
    expect(
      resolveToolAnnotations("getSupplierVersions", READS, {
        title: "Histórico",
        openWorldHint: true,
      }),
    ).toMatchObject({ readOnlyHint: true, openWorldHint: true });
  });

  it("works with no package defaults at all — the host's own tools are unchanged", () => {
    expect(
      resolveToolAnnotations("listOrders", undefined, {
        title: "Pedidos",
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
      }),
    ).toEqual({
      title: "Pedidos",
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    });
  });

  it("refuses a tool neither side finished classifying, naming the gaps", () => {
    // A missing hint blocks ChatGPT App review and the connector directory
    // derives auto-permissions from two of them, so there is no defensible
    // default for "we did not say".
    expect(() => resolveToolAnnotations("mysteryTool", READS, undefined)).toThrow(/title/);
    expect(() => resolveToolAnnotations("mysteryTool", undefined, { title: "X" })).toThrow(
      /readOnlyHint, openWorldHint, destructiveHint/,
    );
  });

  it("treats a blank title as unset — a whitespace label is not a label", () => {
    expect(() => resolveToolAnnotations("mysteryTool", READS, { title: "   " })).toThrow(/title/);
  });

  it("keeps `false` as an answer, not an absence", () => {
    // The trap in any `??`-composed merge: `readOnly: false` is a real
    // classification and must not fall through to the other side.
    expect(
      resolveToolAnnotations(
        "saveSupplierDraft",
        { readOnly: false, destructive: false, openWorld: false },
        { title: "Salvar" },
      ),
    ).toEqual({
      title: "Salvar",
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
    });
  });
});
