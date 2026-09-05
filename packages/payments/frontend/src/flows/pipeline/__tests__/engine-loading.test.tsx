// @vitest-environment jsdom
/**
 * THE ENGINE'S LOADING SENTENCE, ON SCREEN (FUT-1240).
 *
 * `copy.views.pipeline.loading` is a REQUIRED key both packs ship and every
 * adopter must answer. `copy.test.tsx` says why the suite exists — "a copy port
 * that is required and unread is the failure FUT-760 spent a whole ticket on" —
 * and proves the per-method hand-off line is read. This proves the other one.
 *
 * Reading it is not incidental. The engine renders it in the one state a
 * checkout cannot render anything else in: a gate that has not heard back yet,
 * where the alternative is a blank frame and a shopper who taps "pagar" again.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PT_BR_CHECKOUT_VIEW_COPY } from "../../../components/checkout/pt-BR";
import { STORY_CHECKOUT_COPY } from "../../../stories/demo-copy";
import type { AnyCheckoutGate } from "../types";

import { buildHost } from "./pipeline-host";

afterEach(cleanup);
beforeEach(() => window.sessionStorage.clear());

/** A gate that has not heard back — the state the sentence exists for. */
const STILL_ASKING: AnyCheckoutGate = {
  id: "tables",
  decide: () => ({ kind: "pending" }),
};

describe("the engine reads its own loading key", () => {
  it("renders the host's sentence, not a blank frame, while a gate decides", async () => {
    const { flows } = buildHost({ gates: [STILL_ASKING] }, { taxIdOnFile: true });
    render(<flows.Checkout />);

    const loading = await screen.findByTestId("checkout-pipeline-loading");
    expect(loading.textContent).toContain(PT_BR_CHECKOUT_VIEW_COPY.pipeline.loading);
    // The walk is behind the curtain, not beside it.
    await waitFor(() => expect(screen.queryByTestId("checkout-method")).toBeNull());
  });

  it("takes the sentence from the HOST's pack, not a package default", async () => {
    const spoken = "Só um instante, estamos abrindo o seu checkout";
    const { flows } = buildHost(
      {
        gates: [STILL_ASKING],
        copy: {
          ...STORY_CHECKOUT_COPY,
          views: {
            ...PT_BR_CHECKOUT_VIEW_COPY,
            pipeline: { ...PT_BR_CHECKOUT_VIEW_COPY.pipeline, loading: spoken },
          },
        },
      },
      { taxIdOnFile: true },
    );
    render(<flows.Checkout />);

    const loading = await screen.findByTestId("checkout-pipeline-loading");
    expect(loading.textContent).toContain(spoken);
  });
});
