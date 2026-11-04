// @vitest-environment jsdom
/**
 * FUT-4352 — the payer line on the Pagamento bar: "Pagando como … · CPF ✓" and
 * "Alterar" are two flex items on a wrapping row, so "Alterar" wraps as one
 * block (never behind a leading space), "CPF ✓" never splits, and the row holds
 * the reach of the 40px target (FUT-3711) so no neighbour's box overlaps it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { cleanup, render, screen } from "@testing-library/react";

import { PayerLine } from "../list/payer-line";
import { PT_BR_PAYMENT_LIST_COPY } from "../list/pt-BR";

afterEach(cleanup);

/**
 * The declarations emotion wrote for `${scope} button` — read off the sheet,
 * since jsdom's cascade lets the button's own reset win over a nested rule.
 */
function buttonRule(scope: Element): string {
  const name = Array.from(scope.classList).find((cls) => cls.startsWith("css-"));
  if (!name) throw new Error("no emotion class");
  const css = Array.from(document.querySelectorAll("style")).map((style) => style.textContent ?? "").join("\n");
  const found = css.match(new RegExp(`\\.${name} button\\{([^}]*)\\}`));
  if (!found) throw new Error(`no rule for .${name} button`);
  return found[1] ?? "";
}

function renderLine(document: "CPF" | "CNPJ" | null = null) {
  render(<PayerLine copy={PT_BR_PAYMENT_LIST_COPY} name="Maria Aparecida dos Santos" document={document} onChange={vi.fn()} />);
  const row = screen.getByTestId("list-payer");
  const button = screen.getByTestId("list-payer-change");
  return { row, button };
}

describe("PayerLine layout (FUT-4352)", () => {
  it("is a wrapping flex row, aligned on the text's baseline, with a column gap", () => {
    const { row } = renderLine();
    const style = getComputedStyle(row);
    expect(style.display).toBe("flex");
    expect(style.flexWrap).toBe("wrap");
    expect(style.alignItems).toBe("baseline");
    expect(style.columnGap).toBe("4px");
  });

  it("holds the target's reach: the row's padding and its line gap match the button's pull", () => {
    const { row, button } = renderLine();
    const style = getComputedStyle(row);
    const rule = buttonRule(button.parentElement as Element);
    expect(rule).toContain("height:40px;");
    expect(rule).toContain("min-height:40px;");
    expect(rule).toContain("margin-top:-8px;margin-bottom:-8px;");
    expect(style.paddingTop).toBe("8px");
    expect(style.paddingBottom).toBe("8px");
    expect(style.rowGap).toBe("8px");
  });

  it("puts \"Alterar\" in its own flex item that never shrinks, with no leading space", () => {
    const { row, button } = renderLine();
    const items = Array.from(row.children);
    expect(items).toHaveLength(2);
    const [text, slot] = items as [HTMLElement, HTMLElement];
    expect(slot.contains(button)).toBe(true);
    expect(text.contains(button)).toBe(false);
    expect(getComputedStyle(slot).flexShrink).toBe("0");
    expect(text.style.minWidth).toMatch(/^0(px)?$/);
    expect(buttonRule(slot)).toContain("padding-left:0px;padding-right:0px;");
    expect(slot.textContent).toBe("Alterar");
  });

  it.each([["CPF"], ["CNPJ"]] as const)("keeps \"%s ✓\" together, and the words unchanged", (kind) => {
    const { row } = renderLine(kind);
    const [text] = Array.from(row.children) as [HTMLElement];
    expect(text.textContent).toBe(PT_BR_PAYMENT_LIST_COPY.payer("Maria Aparecida dos Santos", kind));
    const tail = Array.from(text.querySelectorAll("span")).find((span) => span.textContent === `${kind} ✓`);
    expect(tail).toBeDefined();
    expect(getComputedStyle(tail as HTMLElement).whiteSpace).toBe("nowrap");
  });
});
