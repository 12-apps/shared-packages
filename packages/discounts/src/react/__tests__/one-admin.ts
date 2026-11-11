import { fireEvent, screen, waitFor } from "@testing-library/react";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, expect } from "vitest";

import { PT_BR_DISCOUNTS_WEB_COPY } from "../pt-BR";

const CLOSED = { timeout: 10_000 };

/**
 * Mount ONE admin for every case of the describe that calls this (FUT-4530).
 *
 * For suites whose cases all open the same row on the same host and differ
 * only in what they do on the edit form. Each case still opens that form from
 * the row's menu, and every opening mounts a fresh, re-seeded form
 * (`DiscountDialog` keys its body per opening); what is no longer paid per
 * case is mounting the list, its grid and its notice, which on a loaded runner
 * was a second of a 5 s case.
 *
 * Rendered outside Testing Library so its after-each cleanup leaves it
 * mounted; the hooks here give each case the screen the previous one found:
 * the form closed (a save closes it; a case that stopped early is closed with
 * Escape) and nothing recorded. `reset` clears what the tree records.
 */
export function oneAdminPerDescribe(tree: () => ReactElement, reset: () => void): void {
  const host = document.createElement("div");
  let root: Root | undefined;
  beforeAll(async () => {
    document.body.appendChild(host);
    const mounted = createRoot(host);
    root = mounted;
    await act(async () => {
      mounted.render(tree());
    });
  });
  afterEach(async () => {
    // A case that saved last leaves the save's own close in flight: let it land
    // first, so a saved form is not asked "Sair sem salvar?" and discarded.
    await act(async () => {});
    const open = screen.queryAllByTestId("discount-form")[0];
    if (open) fireEvent.keyDown(open, { key: "Escape" });
    // A case that changed something meets "Sair sem salvar?" (FUT-4478): discard.
    const discard = screen.queryAllByRole("button", { name: PT_BR_DISCOUNTS_WEB_COPY.steps.chrome.leaveDiscard })[0];
    if (discard) fireEvent.click(discard);
    await waitFor(() => expect(screen.queryAllByTestId("discount-form")).toHaveLength(0), CLOSED);
    reset();
  });
  afterAll(() => {
    act(() => root?.unmount());
    host.remove();
  });
}
