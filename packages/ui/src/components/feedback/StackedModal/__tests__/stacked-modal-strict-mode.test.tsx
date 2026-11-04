/**
 * StrictMode mounts, cleans up and re-runs every effect on the same instance.
 * The unmount pop (FUT-4394) must not leave an open panel out of its stack on
 * the re-run: the three host SPAs render under StrictMode.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { StackedModal, StackedModalProvider } from "../index";

afterEach(cleanup);

describe("StackedModal under StrictMode", () => {
  it("keeps two panels mounted open in the stack: the deeper one offers the way back", async () => {
    render(
      <StrictMode>
        <StackedModalProvider>
          <StackedModal backLabel="Voltar" open onClose={() => undefined} navigationTitle="Primeiro" modalId="first">
            <p>first</p>
          </StackedModal>
          <StackedModal backLabel="Voltar" open onClose={() => undefined} navigationTitle="Segundo" modalId="second">
            <p>second</p>
          </StackedModal>
        </StackedModalProvider>
      </StrictMode>,
    );
    expect(await screen.findByRole("button", { name: "Voltar" })).toBeInTheDocument();
  });
});
