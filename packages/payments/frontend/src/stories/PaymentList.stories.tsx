import type { Meta, StoryObj } from "@storybook/react-vite";

import { ON_FILE, ON_PAGE, SAVED, scene } from "./payment-list-scene";

/**
 * THE PAGAMENTO STEP AS ONE LIST (FUT-3591/3592), against a real mount.
 *
 * The frame around it — the page colour, the 512px column, the "4 Pagamento"
 * step card — is HOST chrome, drawn here only so the list can be looked at
 * the way the entrega checkout will hold it; it is not part of the package.
 * So are the door options: a host's `CheckoutDoorOption[]`, kept as plain
 * state here (the real ones come from the host's own settlement package).
 *
 * The card runs in the server's stub mode, where every card settles — a
 * refusal is the provider's own (`declines` / `ambiguous` on the store), as
 * in the "states" stories.
 */
const meta: Meta = { title: "Checkout/Pagamento — one list" };
export default meta;

/** A returning buyer: CPF on file, a saved Visa — the card comes chosen and Pagar is live. */
export const SavedCard: StoryObj = scene({ chain: [ON_PAGE], instruments: SAVED, amountCents: 2700 }, { taxIdOnFile: true, buyer: ON_FILE });

/** A new buyer: no CPF, no card — nothing chosen; the CPF is asked once, at the top of the step (FUT-3685). */
export const NewBuyer: StoryObj = scene({ chain: [ON_PAGE], amountCents: 2700 }, { taxIdOnFile: false, buyer: { name: "Ana Teste" } });

/** A store that finishes on its own page: one "Pix ou cartão" row, and the buyer's mobile asked inside it. */
export const HandOffStore: StoryObj = scene(
  {
    chain: [{ name: "boreal", methods: ["PIX", "CARD"], stub: true, publicKey: null, hosted: true, checkoutScreen: "hosted-link", customerSchema: [{ key: "phone", type: "MOBILE", required: true }] }],
    amountCents: 2700,
  },
  { taxIdOnFile: false, buyer: { name: "Ana Teste" }, onNavigate: () => undefined },
);

/** Online only — no door options: one heading, no "PAGAR NA ENTREGA". */
export const OnlineOnly: StoryObj = scene({ chain: [ON_PAGE], instruments: SAVED, amountCents: 2700 }, { taxIdOnFile: true, buyer: ON_FILE }, { withDoor: false });
