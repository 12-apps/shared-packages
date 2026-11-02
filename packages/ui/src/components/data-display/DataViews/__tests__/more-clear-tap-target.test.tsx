/**
 * THE "MAIS" FIELD HEADER'S "LIMPAR" IS A 40PX TARGET ON A PHONE (FUT-4144).
 *
 * It is a 12px text button, 37×18, and on a phone that is the whole target
 * (the admin's on-screen check of ui 6.92.1 measured it at 320–900). Below
 * `sm` the header now keeps 10px under itself instead of 4px, and an overlay
 * reaches 12px above and 10px below the button: 40px, over nothing else.
 *
 * jsdom applies no media query, so what it computes is the phone (`xs`)
 * value; the browser driver checks the hit test and that nothing else moved.
 */
import { render, screen } from "./test-utils";
import { describe, expect, it } from "vitest";

import { createTheme } from "@mui/material/styles/index.js";

import { MORE_SPACING, MoreGroup, clearTargetSx, moreHeaderSx } from "../data-views-more-fields";
import { toOverflowFields } from "../data-views-overflow";
import type { FilterFieldConfig, RangeFieldConfig } from "../data-views-types";

type Row = Record<string, unknown>;

const METODO: FilterFieldConfig<Row> = {
  id: "metodo",
  label: "Método",
  options: [
    { value: "pix", label: "PIX" },
    { value: "cartao", label: "Cartão" },
  ],
};
const DATA: RangeFieldConfig<Row> = { id: "data", label: "Data", kind: "day", accessor: () => "" };
const VALOR: RangeFieldConfig<Row> = { id: "valor", label: "Valor", unit: "R$", accessor: () => 0 };

function renderApplied(kind: "enum" | "day" | "number"): HTMLElement {
  const fields = toOverflowFields<Row>(kind === "enum" ? [METODO] : [], kind === "day" ? [DATA] : kind === "number" ? [VALOR] : []);
  const [field] = fields;
  if (!field) throw new Error("no overflow field");
  render(
    <MoreGroup
      field={field}
      pills={{ metodo: ["pix"] }}
      ranges={{ data: { min: "2026-10-01", max: "2026-10-15" }, valor: { min: 5 } }}
      onTogglePill={() => undefined}
      onChangeRange={() => undefined}
      testIdPrefix="t"
    />,
  );
  return screen.getByTestId(`t-more-${field.id}-clear`);
}

describe("the Mais panel's spacing holds the target (FUT-4144 review)", () => {
  it("leaves 10px under EVERY group header on a phone, applied or not, so nothing moves on apply", () => {
    const [field] = toOverflowFields<Row>([METODO], []);
    if (!field) throw new Error("no overflow field");
    render(
      <MoreGroup
        field={field}
        pills={{}}
        ranges={{}}
        onTogglePill={() => undefined}
        onChangeRange={() => undefined}
        testIdPrefix="t"
      />,
    );
    const header = screen.getByText("Método").closest("div") as HTMLElement;
    expect(getComputedStyle(header).marginBottom).toBe("10px");
  });

  it("keeps 4px under the header from sm up", () => {
    const theme = createTheme();
    const sx = moreHeaderSx(theme) as Record<string, unknown>;
    expect(sx[theme.breakpoints.up("sm")]).toEqual({ mb: MORE_SPACING.underHeaderFromSm });
    expect(MORE_SPACING.underHeaderFromSm).toBe(0.5);
  });

  it("never lets the target reach further than the gap above or below it", () => {
    // Everything that can precede a group: another group, a shed quick chip,
    // or the scroller's own top inset (the first group).
    expect(MORE_SPACING.reachUp).toBeLessThanOrEqual(MORE_SPACING.underGroup);
    expect(MORE_SPACING.reachUp).toBeLessThanOrEqual(MORE_SPACING.underQuick);
    expect(MORE_SPACING.reachUp).toBeLessThanOrEqual(MORE_SPACING.aboveFirst);
    expect(MORE_SPACING.reachDown).toBeLessThanOrEqual(MORE_SPACING.underHeader);
    // 18px of text and 22px of reach is 40 at the default type scale.
    expect(MORE_SPACING.reachUp + MORE_SPACING.reachDown).toBeGreaterThanOrEqual(22 / 8);
  });

  it("measures the reach in the theme's spacing, the unit the gaps are in", () => {
    const theme = createTheme({ spacing: 10 });
    const before = (clearTargetSx(theme) as Record<string, Record<string, unknown>>)["&::before"];
    expect(before?.top).toBe(`-${theme.spacing(MORE_SPACING.reachUp)}`);
    expect(before?.bottom).toBe(`-${theme.spacing(MORE_SPACING.reachDown)}`);
    expect(before?.left).toBe(`-${theme.spacing(MORE_SPACING.reachSide)}`);
    expect(before?.right).toBe(`-${theme.spacing(MORE_SPACING.reachSide)}`);
  });
});

describe("the Mais header's Limpar on a phone", () => {
  it.each(["enum", "day", "number"] as const)("leaves 10px under a %s field's header for its target", (kind) => {
    const clear = renderApplied(kind);
    const header = clear.parentElement as HTMLElement;
    expect(getComputedStyle(header).marginBottom).toBe("10px");
  });

  it("anchors its target overlay on itself", () => {
    const clear = renderApplied("enum");
    expect(getComputedStyle(clear).position).toBe("relative");
  });
});
