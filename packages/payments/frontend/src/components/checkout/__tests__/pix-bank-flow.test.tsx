// @vitest-environment jsdom
/**
 * FUT-3612 — after copying a Pix, open the bank app.
 *
 * With the host's `pixBank`, the bar's Pix button generates AND copies in one
 * tap ("Gerar e copiar o Pix"), a toast says so, and on a phone the after-copy
 * face offers six banks in place of the checklist — or, with one remembered
 * ("Gerar, copiar e abrir o Nubank"), opens it, with "Outro banco" to choose
 * again and "Abrir outro banco" under the button. A bank that does not open
 * says so. A copy the clipboard refused moves nothing on. A computer gets the
 * one-tap copy and the toast, never the banks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import { PT_BR_PIX_BANK_COPY } from "../list/bank-pt-BR";
import type { CheckoutPixBank, PixBankId } from "../list/types";
import { onPageStore, orderFor, renderList, stubClient } from "./list-harness";

const opened = vi.hoisted(() => ({ result: true, calls: [] as string[] }));
vi.mock("../list/bank-apps", async (importOriginal) => {
  const real = await importOriginal<typeof import("../list/bank-apps")>();
  return {
    ...real,
    openBankApp: vi.fn(async (bank: string) => {
      opened.calls.push(bank);
      return opened.result;
    }),
  };
});

const writeText = vi.fn(async () => undefined);

beforeEach(() => {
  window.sessionStorage.clear();
  opened.result = true;
  opened.calls = [];
  writeText.mockReset();
  writeText.mockImplementation(async () => undefined);
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

/** This test's bank app does not open (reset before each test). */
function appWillNotOpen(): void {
  opened.result = false;
}

/** The clipboard refuses the next write — the one after it takes the code. */
function clipboardRefusesOnce(): void {
  writeText.mockImplementationOnce(async () => {
    throw new Error("denied");
  });
}

function bankFlow(remembered: PixBankId | null, phone = true, confirmation?: "MANUAL") {
  const onPick = vi.fn();
  const notify = vi.fn();
  const pixBank: CheckoutPixBank = { remembered, onPick, copy: PT_BR_PIX_BANK_COPY, phone };
  const createOrder = confirmation
    ? async () => {
        const order = orderFor("PIX");
        return { ok: true as const, data: { ...order, pix: { ...order.pix!, confirmation } } };
      }
    : undefined;
  renderList({ config: onPageStore(), client: stubClient([]), createOrder, list: { lastMethod: "PIX", pixBank, notify } });
  return { onPick, notify };
}

const pay = (): HTMLButtonElement => screen.getByTestId("list-pay") as HTMLButtonElement;

describe("no bank remembered, on a phone", () => {
  it("generates and copies in one tap, toasts, and offers the six banks in place of the checklist", async () => {
    const { notify } = bankFlow(null);
    await waitFor(() => expect(pay().textContent).toContain("Gerar e copiar o Pix"));
    await waitFor(() => expect(screen.queryByTestId("pix-open-other-bank")).toBeNull());
    fireEvent.click(pay());
    await waitFor(() => expect(screen.getByTestId("pix-bank-grid")).toBeTruthy());
    expect(writeText).toHaveBeenCalledWith("00020126BR.GOV.BCB.PIX.o-pix");
    expect(notify).toHaveBeenCalledWith("Código Pix copiado. Escolha o banco.");
    expect(screen.getByText("Abra seu banco e cole em Pix copia e cola")).toBeTruthy();
    const names = ["Nubank", "Itaú", "Bradesco", "Banco do Brasil", "Caixa", "Santander"];
    for (const name of names) expect(screen.getByRole("button", { name: `Abrir ${name}` })).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId("pix-after-copy-step-1")).toBeNull());
    await waitFor(() => expect(screen.queryByTestId("pix-after-copy-title")).toBeNull());
  });

  it("a pick opens that app and is remembered; 'Outro banco' brings the six back", async () => {
    const { onPick } = bankFlow(null);
    await waitFor(() => expect(pay().textContent).toContain("Gerar e copiar o Pix"));
    fireEvent.click(pay());
    fireEvent.click(await screen.findByRole("button", { name: "Abrir Caixa" }));
    expect(onPick).toHaveBeenCalledWith("caixa");
    await waitFor(() => expect(opened.calls).toEqual(["caixa"]));
    expect(screen.getByTestId("pix-bank-opening").textContent).toContain("Abrindo a Caixa…");
    // The bank picked: one line where the checklist was, as in the approved prototype.
    expect(screen.getByTestId("pix-bank-hint").textContent).toBe("Abra o app do seu banco e cole em Pix copia e cola.");
    await waitFor(() => expect(screen.queryByTestId("pix-after-copy-step-1")).toBeNull());
    fireEvent.click(screen.getByTestId("pix-bank-other"));
    expect(screen.getByTestId("pix-bank-grid")).toBeTruthy();
  });

  it("says so when the app did not open, and 'Tentar de novo' opens it again", async () => {
    appWillNotOpen();
    bankFlow(null);
    await waitFor(() => expect(pay().textContent).toContain("Gerar e copiar o Pix"));
    fireEvent.click(pay());
    fireEvent.click(await screen.findByRole("button", { name: "Abrir Nubank" }));
    await waitFor(() =>
      expect(screen.getByTestId("pix-bank-opening").textContent).toContain("Não conseguimos abrir o Nubank. O app está instalado neste celular?"),
    );
    // The app did not open: the one line still says what to do, still no checklist.
    expect(screen.getByTestId("pix-bank-hint").textContent).toBe("Abra o app do seu banco e cole em Pix copia e cola.");
    await waitFor(() => expect(screen.queryByTestId("pix-after-copy-step-1")).toBeNull());
    fireEvent.click(screen.getByTestId("pix-bank-retry"));
    await waitFor(() => expect(opened.calls).toEqual(["nubank", "nubank"]));
    await waitFor(() => expect(screen.getByTestId("pix-bank-opening").getAttribute("data-status")).toBe("failed"));
    fireEvent.click(screen.getByTestId("pix-bank-other"));
    await waitFor(() => expect(screen.getByTestId("pix-bank-grid")).toBeTruthy());
  });
});

describe("a bank remembered, on a phone", () => {
  it("'Gerar, copiar e abrir o Nubank' copies, toasts and opens it, with 'Abrir outro banco' under the button", async () => {
    const { notify, onPick } = bankFlow("nubank");
    await waitFor(() => expect(pay().textContent).toContain("Gerar, copiar e abrir o Nubank"));
    expect(screen.getByTestId("pix-open-other-bank").textContent).toBe("Abrir outro banco");
    fireEvent.click(pay());
    await waitFor(() => expect(opened.calls).toEqual(["nubank"]));
    expect(notify).toHaveBeenCalledWith("Código Pix copiado. Abrindo o Nubank…");
    expect(screen.getByTestId("pix-bank-opening").textContent).toContain("Abrindo o Nubank…");
    // One line says what to do in the bank, where the checklist was (approved prototype).
    expect(screen.getByTestId("pix-bank-hint").textContent).toBe("Abra o app do seu banco e cole em Pix copia e cola.");
    await waitFor(() => expect(screen.queryByTestId("pix-after-copy-step-1")).toBeNull());
    expect(onPick).not.toHaveBeenCalled();
  });

  it("'Outro banco' under the remembered bank brings the six back, and a new pick replaces it", async () => {
    const { onPick } = bankFlow("nubank");
    await waitFor(() => expect(pay().textContent).toContain("Gerar, copiar e abrir o Nubank"));
    fireEvent.click(pay());
    await waitFor(() => expect(screen.getByTestId("pix-bank-opening")).toBeTruthy());
    fireEvent.click(screen.getByTestId("pix-bank-other"));
    await waitFor(() => expect(screen.getByTestId("pix-bank-grid")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Abrir Itaú" }));
    expect(onPick).toHaveBeenCalledWith("itau");
  });

  it("'Abrir outro banco' copies the same way and shows the six instead of opening", async () => {
    const { notify } = bankFlow("nubank");
    await waitFor(() => expect(screen.getByTestId("pix-open-other-bank")).toBeTruthy());
    fireEvent.click(screen.getByTestId("pix-open-other-bank"));
    await waitFor(() => expect(screen.getByTestId("pix-bank-grid")).toBeTruthy());
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("Código Pix copiado. Escolha o banco.");
    expect(opened.calls).toEqual([]);
  });

  it("a refused copy stays on the code, with 'Copiar e abrir o Nubank' to try by hand — no toast, no app", async () => {
    clipboardRefusesOnce();
    const { notify } = bankFlow("nubank");
    await waitFor(() => expect(pay().textContent).toContain("Gerar, copiar e abrir o Nubank"));
    fireEvent.click(pay());
    await waitFor(() => expect(screen.getByTestId("list-pix-code")).toBeTruthy());
    await waitFor(() => expect(pay().textContent).toBe("Copiar e abrir o Nubank"));
    expect(screen.getByTestId("pix-open-other-bank")).toBeTruthy();
    expect(notify).not.toHaveBeenCalled();
    expect(opened.calls).toEqual([]);
    fireEvent.click(pay());
    await waitFor(() => expect(opened.calls).toEqual(["nubank"]));
  });
});

describe("a Pix the store confirms (MANUAL), a bank remembered", () => {
  it("keeps the checklist that says the store confirms and by when, and no one-line hint", async () => {
    bankFlow("nubank", true, "MANUAL");
    await waitFor(() => expect(pay().textContent).toContain("Gerar, copiar e abrir o Nubank"));
    fireEvent.click(pay());
    await waitFor(() => expect(opened.calls).toEqual(["nubank"]));
    expect(screen.getByTestId("pix-bank-opening").textContent).toContain("Abrindo o Nubank…");
    expect(screen.getByTestId("pix-after-copy-step-3").textContent).toMatch(/A loja confirma o pagamento — até \d{2}:\d{2}/);
    await waitFor(() => expect(screen.queryByTestId("pix-bank-hint")).toBeNull());
  });
});

describe("a Pix the store confirms (MANUAL), no bank remembered", () => {
  it("keeps the checklist under the six banks, so the buyer still reads who confirms and by when", async () => {
    bankFlow(null, true, "MANUAL");
    await waitFor(() => expect(pay().textContent).toContain("Gerar e copiar o Pix"));
    fireEvent.click(pay());
    await waitFor(() => expect(screen.getByTestId("pix-bank-grid")).toBeTruthy());
    expect(screen.getByTestId("pix-after-copy-step-3").textContent).toMatch(/A loja confirma o pagamento — até \d{2}:\d{2}/);
  });
});

describe("on a computer", () => {
  it("generates and copies in one tap and toasts, but keeps today's after-copy face — no banks", async () => {
    const { notify } = bankFlow("nubank", false);
    await waitFor(() => expect(pay().textContent).toContain("Gerar e copiar o Pix"));
    await waitFor(() => expect(screen.queryByTestId("pix-open-other-bank")).toBeNull());
    fireEvent.click(pay());
    await waitFor(() => expect(screen.getByTestId("pix-after-copy")).toBeTruthy());
    expect(notify).toHaveBeenCalledWith("Código Pix copiado");
    await waitFor(() => expect(screen.queryByTestId("pix-bank-grid")).toBeNull());
    await waitFor(() => expect(screen.queryByTestId("pix-bank-opening")).toBeNull());
    expect(screen.getByTestId("pix-after-copy-step-1")).toBeTruthy();
    expect(opened.calls).toEqual([]);
  });
});

describe("without pixBank", () => {
  it("keeps today's 'Gerar Pix' and the copy on a second tap", async () => {
    renderList({ config: onPageStore(), client: stubClient([]), list: { lastMethod: "PIX" } });
    await waitFor(() => expect(pay().textContent).toContain("Gerar Pix"));
    fireEvent.click(pay());
    await waitFor(() => expect(screen.getByTestId("list-pix-code")).toBeTruthy());
    expect(writeText).not.toHaveBeenCalled();
  });
});
