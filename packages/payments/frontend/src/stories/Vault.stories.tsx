import type { Meta, StoryObj } from "@storybook/react-vite";
import type { JSX } from "react";

import type { BuyerVaultSession } from "../components/checkout/transport";
import { STORY_CHECKOUT_COPY } from "./demo-copy";
import { AddCardView } from "../flows/screens-vault";
import type { AddCardController, AddCardPhase } from "../flows/use-add-card";

import { StoryFlow } from "./host";
import type { StorySpec } from "./store";
import { CheckoutCopyProvider } from "../components/checkout/copy-context";

/**
 * The buyer-vault screens (FUT-183): adding a card OUTSIDE a purchase, and the
 * cards already on file — the shopper half of FUT-478's `/cards/begin` +
 * `/cards/complete`.
 *
 * The AT-REST states (form, unavailable, the two lists) mount the factory's
 * screens against a REAL `createPaymentFlowsBE` mount, exactly like every
 * other story here. The POST-SUBMIT states (saving, saved, declined) are one
 * buyer action past at-rest, so they stage the presentational `AddCardView`
 * with a controller literal instead — the same split `card-view.tsx` uses,
 * with the state machine in `use-add-card.ts` and the pixels here.
 *
 * Note what no story offers: a delete button. PagBank publishes no token-
 * delete endpoint, so removal stays a merchant/host concern on the admin
 * surface — see `flows/screens-vault.tsx`.
 */
const meta: Meta = {
  title: "Checkout/Vault",
  parameters: {
    docs: {
      description: {
        component:
          "`screens.AddCard` and `screens.ManageCards` (FUT-183): a shopper puts a card " +
          "on file outside checkout and sees what is already saved. Live states run the " +
          "real in-page mount; post-submit states stage the view with fixtures.",
      },
    },
  },
};
export default meta;

/** A store whose head can vault — the add-card happy path's world. */
const VAULTABLE_STORE: StorySpec = {
  chain: [{ name: "aurora", methods: ["CARD"], stub: true, publicKey: null, vaultable: true }],
};

/** The session a staged controller is mid-flight with (fixture only). */
const STAGED_SESSION: BuyerVaultSession = {
  provider: "aurora",
  tokenization: "PUBLIC_KEY",
  publicKey: null,
  clientSecret: null,
  sessionId: "vs_aurora_1",
};

/** A controller literal for the post-submit states no at-rest mount can show. */
function stagedController(
  phase: AddCardPhase,
  overrides: Partial<AddCardController> = {},
): AddCardController {
  return {
    phase,
    card: { number: "", holder: "", expiry: "", cvv: "" },
    setCard: () => undefined,
    fieldErrors: {},
    setFieldErrors: () => undefined,
    brand: "Unknown",
    saving: false,
    error: null,
    submit: async () => undefined,
    ...overrides,
  };
}

function StagedAddCard({ controller }: { controller: AddCardController }): JSX.Element {
  // Staged: the view alone, with no `FlowsShell` above it — so this host has to
  // supply the words the card fields read from context, exactly as the shell
  // would have (FUT-760).
  return (
    <CheckoutCopyProvider copy={STORY_CHECKOUT_COPY.views.screens}>
      <AddCardView controller={controller} copy={STORY_CHECKOUT_COPY} />
    </CheckoutCopyProvider>
  );
}

// ---------------------------------------------------------------------------
// AddCard
// ---------------------------------------------------------------------------

/** The form at rest: `begin` answered, the shared card fields are live. */
export const AddCardForm: StoryObj = {
  render: () => (
    <StoryFlow spec={VAULTABLE_STORE}>{(flows) => <flows.screens.AddCard />}</StoryFlow>
  ),
};

/** Mid-save: tokenize + `/cards/complete` in flight, the action shows it. */
export const AddCardSaving: StoryObj = {
  render: () => (
    <>
      <StagedAddCard
        controller={stagedController(
          { kind: "form", session: STAGED_SESSION },
          {
            card: { number: "4111 1111 1111 1111", holder: "ANA COMPRADORA", expiry: "12/34", cvv: "123" },
            brand: "Visa",
            saving: true,
          },
        )}
      />
      <p style={{ opacity: 0.6, fontSize: 12 }}>salvando: a chamada /cards/complete está em voo</p>
    </>
  ),
};

/** Saved: display metadata only — brand and last4, never the vault token. */
export const AddCardSaved: StoryObj = {
  render: () => (
    <StagedAddCard
      controller={stagedController({
        kind: "saved",
        display: { brand: "visa", last4: "4242", expMonth: 12, expYear: 2031 },
      })}
    />
  ),
};

/**
 * Declined at `complete`, with the endpoint's field-level reason (the host's
 * `mapProviderError` wording) — and the form still editable underneath it.
 */
export const AddCardDeclined: StoryObj = {
  render: () => (
    <StagedAddCard
      controller={stagedController(
        { kind: "form", session: STAGED_SESSION },
        {
          card: { number: "4000 0000 0000 0002", holder: "ANA COMPRADORA", expiry: "12/34", cvv: "123" },
          brand: "Visa",
          error: "O cartão foi recusado. Confira o número e tente novamente.",
        },
      )}
    />
  ),
};

/**
 * The store cannot vault (its provider declares no vault seam): the REAL
 * mount's 404 becomes the plain "not here" sentence, and no form is offered.
 */
export const AddCardUnavailable: StoryObj = {
  render: () => (
    <StoryFlow spec={{ chain: [{ name: "aurora", methods: ["CARD"], stub: true, publicKey: null }] }}>
      {(flows) => <flows.screens.AddCard />}
    </StoryFlow>
  ),
};

// ---------------------------------------------------------------------------
// ManageCards
// ---------------------------------------------------------------------------

/** Nothing on file yet: the empty-state sentence, and the door to add. */
export const ManageCardsEmpty: StoryObj = {
  render: () => (
    <StoryFlow spec={VAULTABLE_STORE}>{(flows) => <flows.screens.ManageCards />}</StoryFlow>
  ),
};

/** Cards on file, scoped to this store (FUT-697) — display metadata only. */
export const ManageCardsPopulated: StoryObj = {
  render: () => (
    <StoryFlow
      spec={{
        ...VAULTABLE_STORE,
        instruments: [
          { id: "card_1", last4: "4242", brand: "visa", expMonth: 4, expYear: 2030 },
          { id: "card_2", last4: "0005", brand: "mastercard" },
        ],
      }}
    >
      {(flows) => <flows.screens.ManageCards />}
    </StoryFlow>
  ),
};
