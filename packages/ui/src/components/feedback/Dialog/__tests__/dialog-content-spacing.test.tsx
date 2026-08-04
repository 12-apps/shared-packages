/**
 * A titled Dialog must leave room above its body for a floating field label.
 *
 * MUI zeroes `padding-top` on a non-`dividers` `DialogContent` that directly
 * follows a `DialogTitle` (`.MuiDialogTitle-root + &`), on the assumption that
 * the title's own bottom padding is the entire gap. `DialogContent` is also
 * `overflow-y: auto`, which makes it a clipping box — so a body whose first row
 * is a filled outlined field had that field's label, which floats ABOVE the
 * input's border box, sliced in half by the clip edge (FUT-544: "Tipo" in the
 * admin "Novo insumo" dialog).
 *
 * MUI's rule is `(0,2,0)`-specific and beats a plain `sx` entry, so the guard
 * here is a computed-style assertion, not a props one: it fails against any fix
 * that loses the cascade.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Dialog, DialogContent } from "../index";

afterEach(cleanup);

/** Shrunk MUI outlined labels sit at `translate(…, -9px)` — the overhang to clear. */
const FLOATING_LABEL_OVERHANG_PX = 9;

function paddingTopOf(element: HTMLElement): number {
  return Number.parseFloat(globalThis.getComputedStyle(element).paddingTop || "0");
}

describe("Dialog body spacing", () => {
  it("clears a floating field label when the body follows a title", () => {
    render(
      <Dialog open title="Novo insumo" dataTestId="d">
        <DialogContent dataTestId="d">body</DialogContent>
      </Dialog>,
    );

    expect(paddingTopOf(screen.getByTestId("d-content"))).toBeGreaterThan(
      FLOATING_LABEL_OVERHANG_PX,
    );
  });

  it("clears it in the dense body too", () => {
    render(
      <Dialog open title="Novo insumo" dataTestId="d">
        <DialogContent dense dataTestId="d">
          body
        </DialogContent>
      </Dialog>,
    );

    expect(paddingTopOf(screen.getByTestId("d-content"))).toBeGreaterThan(
      FLOATING_LABEL_OVERHANG_PX,
    );
  });

  it("keeps the roomier padding when there is no title to sit under", () => {
    render(
      <Dialog open dataTestId="d">
        <DialogContent dataTestId="d">body</DialogContent>
      </Dialog>,
    );

    expect(paddingTopOf(screen.getByTestId("d-content"))).toBe(24);
  });
});
