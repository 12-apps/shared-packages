import { createContext, useContext, useState, type JSX, type ReactNode } from "react";

/**
 * Which face the PIX pane is showing: the code to pay, or the wait that
 * follows a copy (the 2026-10-06 Pix redesign).
 *
 * The flag lives ABOVE the pane, in the payment step, because the after-copy
 * face hides the method picker — and the picker is the step's, not the
 * pane's. `preferCard` is the step's way to the card, offered only when the
 * store takes one: with the picker hidden it is the buyer's only route there,
 * so it must never point at a method the store cannot charge.
 */
export interface PixStage {
  afterCopy: boolean;
  setAfterCopy: (afterCopy: boolean) => void;
  preferCard?: () => void;
}

const PixStageContext = createContext<PixStage | null>(null);

export function PixStageProvider({ stage, children }: { stage: PixStage; children: ReactNode }): JSX.Element {
  return <PixStageContext.Provider value={stage}>{children}</PixStageContext.Provider>;
}

/**
 * The stage the pane renders against. A pane mounted outside a payment step
 * (a host composing `PixView` on its own, a unit test) keeps its own flag and
 * offers no way to the card.
 */
export function usePixStage(): PixStage {
  const shared = useContext(PixStageContext);
  const [afterCopy, setAfterCopy] = useState(false);
  return shared ?? { afterCopy, setAfterCopy };
}
