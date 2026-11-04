// @vitest-environment jsdom
/**
 * FUT-4352 — the payer line on the Pagamento bar: "Pagando como … · CPF ✓
 * Alterar" is one run of text. "· CPF ✓" and "Alterar" stay together on one
 * line (the dot never dangles, "Alterar" never starts a line behind a leading
 * space), the name wraps as text does, and "Alterar"'s 40px target (FUT-3711) is
 * a pseudo-element centred on the line, so it takes no layout height.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { cleanup, render, screen } from "@testing-library/react";

import { PayerLine } from "../list/payer-line";
import { PT_BR_PAYMENT_LIST_COPY } from "../list/pt-BR";

afterEach(cleanup);

const NAME = "Maria Aparecida dos Santos";

/**
 * The declarations emotion wrote for `.<class of scope><suffix>` — read off the
 * sheet, since jsdom's cascade lets the button's own reset win over a nested rule.
 */
function ruleOf(scope: Element, suffix: string): string {
  const name = Array.from(scope.classList).find((cls) => cls.startsWith("css-"));
  if (!name) throw new Error("no emotion class");
  const css = Array.from(document.querySelectorAll("style")).map((style) => style.textContent ?? "").join("\n");
  const escaped = suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const found = css.match(new RegExp(`\\.${name}${escaped}\\{([^}]*)\\}`));
  if (!found) throw new Error(`no rule for .${name}${suffix}`);
  return found[1] ?? "";
}

function renderLine(document: "CPF" | "CNPJ" | null = null) {
  render(<PayerLine copy={PT_BR_PAYMENT_LIST_COPY} name={NAME} document={document} onChange={vi.fn()} />);
  const row = screen.getByTestId("list-payer");
  const button = screen.getByTestId("list-payer-change");
  const slot = button.parentElement as HTMLElement;
  return { row, button, slot };
}

describe("PayerLine layout (FUT-4352)", () => {
  it("is one run of text: the sentence is a block, and Alterar an inline-flex item inside it", () => {
    const { row, slot } = renderLine();
    expect(row.children).toHaveLength(1);
    const text = row.firstElementChild as HTMLElement;
    expect(text.style.display).toBe("block");
    expect(text.contains(slot)).toBe(true);
    expect(getComputedStyle(slot).display).toBe("inline-flex");
    expect(slot.textContent).toBe("Alterar");
  });

  it.each([["CPF"], ["CNPJ"]] as const)("keeps \"· %s ✓\" and Alterar together, with the words unchanged", (kind) => {
    const { row, slot } = renderLine(kind);
    const sentence = PT_BR_PAYMENT_LIST_COPY.payer(NAME, kind);
    // Character for character the copy's, then "Alterar".
    expect(row.textContent).toBe(`${sentence}Alterar`);
    const tail = slot.parentElement as HTMLElement;
    expect(tail.textContent).toBe(`· ${kind} ✓Alterar`);
    expect(getComputedStyle(tail).whiteSpace).toBe("nowrap");
    // No space of its own before Alterar: a 2px step, which a wrap would carry along with "· CPF ✓".
    expect(ruleOf(slot, "")).toContain("margin-left:2px;");
  });

  it("gives Alterar a 40px hit area that takes no layout height", () => {
    const { slot } = renderLine();
    const button = ruleOf(slot, " button");
    expect(button).toContain("min-height:0;");
    expect(button).toContain("height:auto;");
    expect(button).toContain("padding:0px;");
    expect(button).toContain("line-height:inherit;");
    expect(button).toContain("position:relative;");
    const target = ruleOf(slot, " button::before");
    expect(target).toContain("position:absolute;");
    expect(target).toContain("top:50%;");
    expect(target).toContain("height:40px;");
    expect(target).toContain("transform:translateY(-50%);");
  });

  it("keeps room above and below the line for the target's reach", () => {
    const { row } = renderLine();
    const style = getComputedStyle(row);
    expect(style.paddingTop).toBe("8px");
    expect(style.paddingBottom).toBe("2px");
  });
});
