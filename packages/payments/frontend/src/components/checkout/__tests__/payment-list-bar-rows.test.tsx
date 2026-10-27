// @vitest-environment jsdom
/**
 * FUT-3711 — the phone's bar holds only the rows it draws: a block the host
 * handed that renders nothing takes no row (and so no gap), and the live
 * region is out of the flow while it has no reason to show.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import { onPageStore, renderList, stubClient } from "./list-harness";

/** A host extra with nothing to say right now. */
function NothingYet(): null {
  return null;
}

beforeEach(() => window.sessionStorage.clear());
afterEach(cleanup);

describe("the bar's rows", () => {
  it("draws no row for a host extra that renders nothing", async () => {
    renderList({ config: onPageStore(), client: stubClient(), list: { summary: "2 itens", onlineExtras: <NothingYet /> } });
    fireEvent.click(await screen.findByTestId("list-option-PIX-radio"));
    const extras = await screen.findByTestId("list-bar-extras");
    expect(extras.matches(":empty")).toBe(true);
    expect(getComputedStyle(extras).display).toBe("none");
    expect(getComputedStyle(screen.getByTestId("list-bar-summary")).display).not.toBe("none");
  });

  it("takes the live region out of the flow once there is no reason under the button", async () => {
    renderList({ config: onPageStore(), client: stubClient(), taxIdOnFile: false });
    fireEvent.click(await screen.findByTestId("list-option-PIX-radio"));
    await waitFor(() => expect(screen.getByTestId("list-blocked-reason").textContent).toBe("Digite seu CPF ou CNPJ para pagar pelo app."));
    const live = screen.getByTestId("list-bar-live");
    expect(getComputedStyle(live).position).not.toBe("absolute");
    fireEvent.change(await screen.findByTestId("list-buyer-taxId"), { target: { value: "529.982.247-25" } });
    await waitFor(() => expect((screen.getByTestId("list-pay") as HTMLButtonElement).disabled).toBe(false));
    // The same region, mounted all along, now drawn nowhere and taking no row.
    expect(screen.getByTestId("list-bar-live")).toBe(live);
    expect(getComputedStyle(live).position).toBe("absolute");
  });
});
