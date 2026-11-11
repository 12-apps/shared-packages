// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Fields } from "@12-apps/ui/form/total-form";

import { createDiscountsApiClient, type DiscountWireRecord, type WireTargetGroup } from "../api";
import { DiscountForm } from "../discount-form";
import { createFormatters } from "../format";
import { PT_BR_DISCOUNTS_WEB_COPY } from "../pt-BR";
import type { DiscountsResult, DiscountsTransport } from "../transport";

import HARNESS_TARGETS from "./fixtures/harness-targets.json";
import { peek } from "./step-form-shim";

/**
 * The step form on screen (FUT-4477, FUT-4478): Continuar held exactly while
 * its step has errors, the flow's moves, the done cards' lines, the chrome
 * (pill, pendências, strip), dirty, and a server's field errors routed to
 * their step. Picker internals are the harness journey's; nothing here picks.
 */

const copy = PT_BR_DISCOUNTS_WEB_COPY;
const formatters = createFormatters("pt-BR", "BRL");
const GROUPS = HARNESS_TARGETS as WireTargetGroup[];

function CurrencyField({ name, label }: { name: string; label: string }) {
  return <Fields.TextField name={name} label={label} />;
}

const COUPON_RULE: DiscountWireRecord = {
  id: "d-1",
  name: "R$ 5 no X-Salada",
  type: "FIXED_AMOUNT",
  percentOffBp: null,
  amountOffCents: 500,
  scope: "ITEM",
  trigger: "CODE",
  code: "XSALADA5",
  startsAt: null,
  endsAt: null,
  minSubtotalCents: null,
  usageLimit: null,
  perBuyerLimit: null,
  usageCount: 0,
  stackable: true,
  active: true,
  categoryIds: [],
  menuItemIds: ["item-x-salada"],
  createdAt: "2026-11-01T00:00:00.000Z",
};

function renderForm(
  editing: DiscountWireRecord | null = null,
  refuse: Record<string, string> | null = null,
): { sent: unknown[]; dirty: ReturnType<typeof vi.fn> } {
  const sent: unknown[] = [];
  const dirty = vi.fn();
  const transport: DiscountsTransport = {
    get: <T,>(): Promise<T> => Promise.resolve({ data: GROUPS } as T),
    send: <T,>(_url: string, _method: string, body?: unknown): Promise<DiscountsResult<T>> => {
      sent.push(body);
      return Promise.resolve(
        refuse ? { ok: false, error: "Recusado.", fieldErrors: refuse } : { ok: true, data: null as T },
      );
    },
  };
  render(
    <DiscountForm
      api={createDiscountsApiClient("/api/admin/harness", transport, formatters)}
      copy={copy}
      formatters={formatters}
      currencyField={CurrencyField}
      groups={GROUPS}
      editing={editing}
      onSaved={() => {}}
      onError={() => {}}
      onDirtyChange={dirty}
    />,
  );
  return { sent, dirty };
}

const next = (step: number): HTMLElement => screen.getByTestId(`discount-step-${step}-next`);
const missing = (step: number): string => screen.getByTestId(`discount-step-${step}-missing`).textContent ?? "";
const state = (id: string): string | null => screen.getByTestId(`discount-steps-${id}`).getAttribute("data-state");
function type(testId: string, value: string): void {
  const node = screen.getByTestId(testId);
  fireEvent.change(node.querySelector("input") ?? node, { target: { value } });
}

afterEach(() => cleanup());

describe("Continuar is held exactly while its step has errors", () => {
  it("N1: no name: disabled, described by 'Falta: nome'; a name frees it", async () => {
    renderForm();
    expect(next(1).hasAttribute("disabled")).toBe(true);
    expect(next(1).getAttribute("aria-describedby")).toBe("discount-step-1-missing");
    expect(missing(1)).toBe("Falta: nome");
    // Not tried yet: the field itself says nothing.
    await waitFor(() => expect(screen.queryByTestId("total-form-field-name-message")).toBeNull());
    type("total-form-field-name", "Happy hour");
    await waitFor(() => expect(next(1).hasAttribute("disabled")).toBe(false));
    expect(missing(1)).toBe("");
  });

  it("N2: three Continuar and Pronto, then every card is done and Criar is free", async () => {
    renderForm();
    type("total-form-field-name", "Happy hour");
    fireEvent.click(next(1));
    expect(state("identity")).toBe("done");
    expect(state("targets")).toBe("current");
    fireEvent.click(next(2));
    type("total-form-field-percentOff", "10");
    fireEvent.click(next(3));
    // Step 4 opens with its defaults, and Pronto is free.
    expect(state("rules")).toBe("current");
    expect(screen.getByTestId("discount-submit-hold").textContent).toBe("Termine o passo 4 para criar.");
    fireEvent.click(next(4));
    expect(["identity", "targets", "price", "rules"].map(state)).toEqual(["done", "done", "done", "done"]);
    expect(screen.getByTestId("discount-form-submit").hasAttribute("disabled")).toBe(false);
    expect(screen.getByTestId("discount-steps-price-answer").textContent).toBe("Desconto (%): 10%");
  });

  it("N3: a passed step broken later shows 'Falta' on its card and in the pendências", async () => {
    renderForm();
    type("total-form-field-name", "Happy hour");
    fireEvent.click(next(1));
    fireEvent.click(next(2));
    fireEvent.click(screen.getByTestId("discount-steps-identity-change"));
    type("total-form-field-name", "");
    // Tried (it was passed): the message shows, live.
    await waitFor(() => expect(peek("total-form-field-name-message").textContent).toBe(copy.form.nameRequired));
    expect(screen.getByTestId("discount-issues-button").textContent).toBe("1 pendência");
  });
});

describe("the flow", () => {
  it("W1: a Tipo change sends steps 2–4 back to to-do", () => {
    renderForm();
    type("total-form-field-name", "Happy hour");
    fireEvent.click(next(1));
    fireEvent.click(next(2));
    fireEvent.click(screen.getByTestId("discount-steps-identity-change"));
    fireEvent.click(screen.getByTestId("discount-kind-COMBO"));
    expect(["targets", "price", "rules"].map(state)).toEqual(["todo", "todo", "todo"]);
  });

  it("W2: Ver tudo opens every step with no Continuar, and back returns to the step after reached", async () => {
    renderForm();
    fireEvent.click(screen.getByTestId("discount-see-all"));
    expect(screen.queryAllByTestId(/^discount-step-\d-next$/u)).toHaveLength(0);
    expect(screen.getByTestId("total-form-field-percentOff")).toBeTruthy();
    // Nothing tried: nothing red, but the pendências count every step.
    await waitFor(() => expect(screen.queryByTestId("total-form-field-name-message")).toBeNull());
    expect(screen.getByTestId("discount-issues-button").textContent).toBe("2 pendências");
    fireEvent.click(screen.getByTestId("discount-see-all"));
    expect(state("identity")).toBe("current");
  });

  it("W3: a pendência leaves Ver tudo and opens only its step, tried", async () => {
    renderForm();
    fireEvent.click(screen.getByTestId("discount-see-all"));
    fireEvent.click(screen.getByTestId("discount-issues-button"));
    const panel = screen.getByRole("region", { name: copy.steps.chrome.issuesRegion });
    expect(within(panel).getByTestId("discount-issue-1").textContent).toBe(`Preço${copy.form.invalidPercent}`);
    fireEvent.click(within(panel).getByTestId("discount-issue-1"));
    expect(state("price")).toBe("current");
    expect(state("identity")).not.toBe("current");
    await waitFor(() => expect(peek("total-form-field-percentOff-message").textContent).toBe(copy.form.invalidPercent));
  });
});

describe("editing", () => {
  it("E1: every step done, no Ver tudo, pill Salvo, Nada mudou, the strip", async () => {
    renderForm(COUPON_RULE);
    expect(["identity", "targets", "price", "rules"].map(state)).toEqual(["done", "done", "done", "done"]);
    await waitFor(() => expect(screen.queryByTestId("discount-see-all")).toBeNull());
    expect(screen.getByTestId("discount-state-pill").textContent).toBe("Salvo");
    expect(screen.getByTestId("discount-submit-hold").textContent).toBe("Nada mudou.");
    const strip = screen.getByRole("toolbar", { name: copy.steps.chrome.strip });
    expect(within(strip).getAllByRole("button").map((chip) => chip.textContent)).toEqual([
      "Ativo",
      "Cupom XSALADA5",
      "Sem prazo",
      "Acumulável",
      "Sem limites",
      "Qualquer cliente",
    ]);
  });

  it("E2: a chip opens step 4; a change makes it dirty, and the pill and Salvar say so", async () => {
    const { dirty } = renderForm(COUPON_RULE);
    fireEvent.click(screen.getByTestId("discount-strip-activation"));
    expect(state("rules")).toBe("current");
    type("total-form-field-code", "XSALADA6");
    await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(true));
    expect(screen.getByTestId("discount-state-pill").textContent).toBe("Alterações não salvas");
    expect(screen.getByTestId("discount-form-submit").hasAttribute("disabled")).toBe(false);
    type("total-form-field-code", "XSALADA5");
    await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(false));
  });

  it("E3: the strip is one Tab stop and the arrows walk it", async () => {
    renderForm(COUPON_RULE);
    const chips = within(screen.getByRole("toolbar", { name: copy.steps.chrome.strip })).getAllByRole("button");
    expect(chips.map((chip) => chip.getAttribute("tabindex"))).toEqual(["0", "-1", "-1", "-1", "-1", "-1"]);
    fireEvent.keyDown(chips[0]!, { key: "End" });
    await waitFor(() => expect(document.activeElement).toBe(chips[5]));
  });
});

describe("the strip's roving stop", () => {
  it("E4: a strip that loses chips keeps exactly one Tab stop", async () => {
    renderForm(COUPON_RULE);
    const strip = (): HTMLElement => screen.getByRole("toolbar", { name: copy.steps.chrome.strip });
    const before = within(strip()).getAllByRole("button");
    fireEvent.keyDown(before[0]!, { key: "End" });
    await waitFor(() => expect(document.activeElement).toBe(before[before.length - 1]));
    fireEvent.click(screen.getByTestId("discount-strip-activation"));
    fireEvent.click(screen.getByTestId("discount-steps-identity-change"));
    fireEvent.click(screen.getByTestId("discount-kind-COMBO"));
    await waitFor(() => expect(within(strip()).getAllByRole("button").length).toBeLessThan(before.length));
    const stops = within(strip()).getAllByRole("button").filter((chip) => chip.getAttribute("tabindex") === "0");
    expect(stops).toHaveLength(1);
  });
});

describe("a server refusal", () => {
  it("S1: a field error opens its step, tried, says it there, and survives typing elsewhere", async () => {
    const { sent } = renderForm(COUPON_RULE, { code: "Este código já existe." });
    fireEvent.click(screen.getByTestId("discount-strip-limits"));
    type("total-form-field-usageLimit", "5");
    fireEvent.click(screen.getByTestId("discount-form-submit"));
    await waitFor(() => expect(sent).toHaveLength(1));
    await waitFor(() => expect(peek("total-form-field-code-message").textContent).toBe("Este código já existe."));
    expect(state("rules")).toBe("current");
    expect(screen.getByTestId("total-form-error-snackbar")).toBeTruthy();
    type("total-form-field-perBuyerLimit", "1");
    await waitFor(() => expect(peek("total-form-field-code-message").textContent).toBe("Este código já existe."));
    type("total-form-field-code", "OUTRO");
    await waitFor(() => expect(screen.queryByTestId("total-form-field-code-message")).toBeNull());
    await waitFor(() => expect(screen.queryByTestId("total-form-error-snackbar")).toBeNull());
  });

  it("S3: in Ver tudo a field error leaves it and opens the step that owns the field", async () => {
    const { sent } = renderForm(null, { percentOff: "Acima do permitido.", name: "Nome em uso." });
    type("total-form-field-name", "Happy hour");
    fireEvent.click(screen.getByTestId("discount-see-all"));
    type("total-form-field-percentOff", "10");
    await waitFor(() => expect(screen.getByTestId("discount-form-submit").hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByTestId("discount-form-submit"));
    await waitFor(() => expect(sent).toHaveLength(1));
    // Two steps at fault: the lowest opens alone, and both say their error.
    await waitFor(() => expect(state("identity")).toBe("current"));
    expect(["targets", "price", "rules"].map(state)).not.toContain("current");
    await waitFor(() => expect(peek("total-form-field-name-message").textContent).toBe("Nome em uso."));
  });

  it("S2: a key the table does not list stays in the alert only", async () => {
    renderForm(COUPON_RULE, { comboRequirements: "Grupo inválido." });
    fireEvent.click(screen.getByTestId("discount-strip-limits"));
    type("total-form-field-usageLimit", "5");
    fireEvent.click(screen.getByTestId("discount-form-submit"));
    expect(await screen.findByTestId("discount-form-error")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("Grupo inválido.")).toBeNull());
  });
});
