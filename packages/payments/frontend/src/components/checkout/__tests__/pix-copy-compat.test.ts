/**
 * The keys the 2026-10-06 Pix redesign stopped reading (FUT-3368) stay on the
 * type as deprecated optionals in their OLD shapes, so a host pack that still
 * carries them only has to add the new keys — not delete the old ones too.
 */
import { describe, expect, it } from "vitest";

import { PT_BR_CHECKOUT_SCREENS_COPY } from "../screens-pt-BR";
import type { PixPaneCopy } from "../screens-copy";

const current = PT_BR_CHECKOUT_SCREENS_COPY.pix;
const manual = current.manual;

describe("the pix copy type keeps the retired keys' old shapes", () => {
  it("accepts a pack that still carries instructions and the manual notice", () => {
    const pack = {
      ...current,
      instructions: (totalLabel: string) => `Pague ${totalLabel}.`,
      manual: manual && {
        ...manual,
        instructions: (totalLabel: string) => `Pague ${totalLabel}; a loja confere.`,
        copied: { title: "Código copiado", description: "Aguarde a loja." },
      },
    } satisfies PixPaneCopy;

    expect(pack.instructions("R$ 1,00")).toBe("Pague R$ 1,00.");
  });
});
