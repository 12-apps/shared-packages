// @vitest-environment jsdom
/**
 * The host hold's tone (FUT-1055): a hold reads in `danger` unless the host
 * says it is a wait that is nobody's fault, such as the device being offline;
 * then it reads in the secondary ink, at 4.5:1 or better on the paper.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";

import { ListBar } from "../list/list-bar";
import type { CheckoutDoorOption, CheckoutListHold } from "../list/types";
import { SAVED_VISA, listFlow, onPageStore, renderList, stubClient } from "./list-harness";
import { render } from "./test-utils";

afterEach(cleanup);

const THEME = createTheme();

/** A colour as jsdom's computed style spells it. */
function computed(colour: string): string {
  const probe = document.createElement("i");
  probe.style.color = colour;
  return probe.style.color;
}

/** WCAG contrast of `ink` (any alpha) composited over the opaque `ground`. */
function contrastOver(ink: string, ground: string): number {
  const parse = (c: string): number[] => (c.match(/[\d.]+/g) ?? []).map(Number);
  const [ir = 0, ig = 0, ib = 0, ia = 1] = parse(computed(ink));
  const [gr = 0, gg = 0, gb = 0] = parse(computed(ground));
  const seen = [ir * ia + gr * (1 - ia), ig * ia + gg * (1 - ia), ib * ia + gb * (1 - ia)];
  const lum = ([r = 0, g = 0, b = 0]: number[]): number => {
    const [x = 0, y = 0, z = 0] = [r, g, b].map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * x + 0.7152 * y + 0.0722 * z;
  };
  const [hi, lo] = [lum(seen), lum([gr, gg, gb])].sort((a, b) => b - a) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

async function heldReason(hold: CheckoutListHold): Promise<HTMLElement> {
  renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), list: { hold } });
  return waitFor(() => screen.getByTestId("list-blocked-reason"));
}

describe("the host hold's tone", () => {
  it("reads in danger when the host names no tone, as every hold did before", async () => {
    const reason = await heldReason({ action: "Escolha o horário", reason: "Escolha o horário no passo 2." });
    expect(getComputedStyle(reason).color).toBe(computed(THEME.palette.error.main));
  });

  it("reads in danger when the host says so", async () => {
    const reason = await heldReason({ action: "Escolha o horário", reason: "Escolha o horário no passo 2.", tone: "danger" });
    expect(getComputedStyle(reason).color).toBe(computed(THEME.palette.error.main));
  });

  it("reads in the secondary ink for a neutral hold, at 4.5:1 or better on the paper", async () => {
    const reason = await heldReason({ action: "Sem conexão", reason: "Sem conexão. O pagamento volta quando a internet voltar.", tone: "neutral" });
    const ink = getComputedStyle(reason).color;
    expect(ink).toBe(computed(THEME.palette.text.secondary));
    expect(contrastOver(ink, THEME.palette.background.paper)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    [undefined, THEME.palette.error.main],
    ["danger", THEME.palette.error.main],
    ["neutral", THEME.palette.text.secondary],
  ] as const)("the bar draws a reason of tone %s in its ink (the PIX face passes the hold's tone straight)", (tone, ink) => {
    render(
      <ListBar reason="Sem conexão." reasonTone={tone}>
        <button type="button">Copiar código</button>
      </ListBar>,
    );
    expect(getComputedStyle(screen.getByTestId("list-blocked-reason")).color).toBe(computed(ink));
  });

  it("a neutral hold stays danger where the reason drawn is not the hold's: a door option's error (list-face)", async () => {
    const door: CheckoutDoorOption = { id: "cash", label: "Dinheiro", action: "Enviar pedido", blocked: null, error: "Não deu para enviar o pedido.", onSend: vi.fn() };
    renderList({
      config: onPageStore(),
      client: stubClient([SAVED_VISA]),
      list: { door: [door], hold: { action: "Sem conexão", reason: "Sem conexão.", tone: "neutral" } },
    });
    await screen.findByTestId("payment-list");
    fireEvent.click(screen.getByTestId("list-door-cash-radio"));
    await waitFor(() => expect(screen.getByTestId("list-blocked-reason").textContent).toBe("Não deu para enviar o pedido."));
    expect(getComputedStyle(screen.getByTestId("list-blocked-reason")).color).toBe(computed(THEME.palette.error.main));
  });

  it("the PIX face draws a neutral hold in the secondary ink (list-pix)", async () => {
    const host = { config: onPageStore({ methods: ["PIX"] }), client: stubClient([]) };
    const { rerender } = renderList(host);
    await screen.findByTestId("payment-list");
    fireEvent.click(screen.getByTestId("list-option-PIX-radio"));
    fireEvent.click(screen.getByTestId("list-pay"));
    await screen.findByTestId("list-pix");
    rerender(listFlow({ ...host, list: { hold: { action: "Aguardando a internet", reason: "Sem conexão. O pagamento volta quando a internet voltar.", tone: "neutral" } } }));
    const reason = await waitFor(() => screen.getByTestId("list-blocked-reason"));
    expect(screen.getByTestId("list-pix")).toBeTruthy();
    expect(getComputedStyle(reason).color).toBe(computed(THEME.palette.text.secondary));
  });
});

describe("the neutral reason in a dark theme", () => {
  const DARK = createTheme({ palette: { mode: "dark" } });

  it("reads in the dark theme's secondary ink at 4.5:1 or better on its paper", () => {
    render(
      <ThemeProvider theme={DARK}>
        <ListBar reason="Sem conexão." reasonTone="neutral">
          <button type="button">Copiar código</button>
        </ListBar>
      </ThemeProvider>,
    );
    const ink = getComputedStyle(screen.getByTestId("list-blocked-reason")).color;
    expect(ink).toBe(computed(DARK.palette.text.secondary));
    expect(contrastOver(ink, DARK.palette.background.paper)).toBeGreaterThanOrEqual(4.5);
  });
});
