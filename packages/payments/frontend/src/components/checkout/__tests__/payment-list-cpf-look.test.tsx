// @vitest-environment jsdom
/**
 * FUT-3711 — the CPF at the top, as the entrega UI review drew it (L7):
 *
 *  - ~280px once the LIST is wide enough for it (≥ 560px of its own), read off
 *    the list's container — a host's ~680px left column is under the flow's
 *    900px "wide" and the field still stops; full width on a phone.
 *  - "Salvar meus dados para a próxima compra" flush with the field's left
 *    edge (no checkbox ring, no label inset), "Manter o documento salvo" flush too
 *    and in the neutral ink, one 12px step between each.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import type { CheckoutButtonProps } from "../ui";
import { onPageStore, renderList, stubClient } from "./list-harness";

/** Every rule emotion wrote, as one text. */
function styleText(): string {
  return Array.from(document.querySelectorAll("style"))
    .map((style) => style.textContent ?? "")
    .join("\n");
}

/** The emotion class of `element` (`css-…`). */
function emotionClass(element: Element): string {
  const found = Array.from(element.classList).find((name) => name.startsWith("css-"));
  if (!found) throw new Error("no emotion class");
  return found;
}

/** Whether `css` (whitespace stripped) holds `selector` with exactly these declarations, in order. */
function hasRule(css: string, selector: string, ...declarations: string[]): boolean {
  return css.includes(`${selector}{${declarations.map((declaration) => `${declaration};`).join("")}}`);
}

const newBuyer = () => ({ config: onPageStore(), client: stubClient(), taxIdOnFile: false, saveBuyerContact: vi.fn() });

beforeEach(() => window.sessionStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe("the CPF field's width (L7)", () => {
  it("stops at 280px from 560px of the list's own width, and is full width under it", async () => {
    renderList(newBuyer());
    const field = await screen.findByTestId("list-cpf-field");
    const css = styleText().replace(/\s+/g, "");
    // The list's CPF block is the container the query reads…
    expect(css).toContain(`.${emotionClass(screen.getByTestId("list-cpf"))}{`);
    expect(getComputedStyle(screen.getByTestId("list-cpf")).getPropertyValue("container-type")).toBe("inline-size");
    // …and the field is full width, capped only inside the query.
    const fieldClass = emotionClass(field);
    expect(css).toMatch(new RegExp(`\\.${fieldClass}\\{width:100%;\\}`));
    // CSS text, not copy: read as a rule, whole.
    expect(css.includes(`@container(min-width:560px){.${fieldClass}{max-width:280px;}}`)).toBe(true);
  });
});

describe("the rows under the field (L7)", () => {
  it("puts the consent checkbox flush with the field: no ring, no label inset, 12px under it", async () => {
    renderList(newBuyer());
    await screen.findByTestId("list-buyer-taxId");
    const label = screen.getByText("Salvar meus dados para a próxima compra").closest(".MuiFormControlLabel-root");
    expect(label?.closest('[data-testid="list-save-profile-row"]')).toBeTruthy();
    // jsdom cascades by order, not specificity, so the rules are read as written: two
    // classes deep, over MUI's one-class -11px inset and 9px ring.
    const row = emotionClass(screen.getByTestId("list-save-profile-row"));
    const css = styleText().replace(/\s+/g, "");
    const labelRule = `.${row}.MuiFormControlLabel-root`;
    expect(hasRule(css, labelRule, "margin-left:0px", "margin-right:0px")).toBe(true);
    expect(hasRule(css, `${labelRule}.MuiCheckbox-root`, "padding:0px", "margin-right:8px")).toBe(true);
    expect(css).toMatch(new RegExp(`\\.${emotionClass(screen.getByTestId("list-cpf"))}\\{[^}]*gap:12px`));
  });

  it("draws 'Manter o documento salvo' as a neutral link, flush with the field", async () => {
    const buttons: CheckoutButtonProps[] = [];
    const Button = (props: CheckoutButtonProps) => {
      buttons.push(props);
      return (
        <button type="button" data-testid={props.dataTestId} onClick={props.onClick}>
          {props.children}
        </button>
      );
    };
    renderList({ config: onPageStore(), client: stubClient(), taxIdOnFile: true, buyer: { name: "Ana Teste" }, components: { Button } });
    fireEvent.click(await screen.findByTestId("list-payer-change"));
    const keep = await screen.findByTestId("list-cpf-keep");
    const drawn = buttons.filter((props) => props.dataTestId === "list-cpf-keep");
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.every((props) => props.color === "neutral" && props.variant === "text")).toBe(true);
    await waitFor(() => expect(getComputedStyle(keep).paddingLeft).toBe("0px"));
  });
});
