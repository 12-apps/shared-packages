import type { JSX } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { CapabilityDefaultScreen } from "../components/checkout/providers/capability-default";
import { HostedLinkScreen } from "../components/checkout/providers/hosted-link";
import { PixAndCardScreen } from "../components/checkout/providers/pix-and-card";
import { resolveCheckoutScreen } from "../components/checkout/providers/registry";
import type {
  ProviderCheckoutScreen,
  ProviderCheckoutScreenProps,
} from "../components/checkout/providers/types";
import type { CheckoutOrder, CheckoutProviderConfig } from "../index";

import { StoryFlow } from "./host";

/**
 * The per-provider checkout screens, each on its own (FUT-596).
 *
 * What is under review here is not "does the checkout work" — `Checkout.stories`
 * covers that — but the claim that a provider's flow gets ITS OWN screen, that
 * the two shipped screens carry no branch for each other, and that a provider
 * declaring nothing still lands on something renderable.
 *
 * Every store below is a FICTIONAL provider (`aurora`, `boreal`). That is
 * possible precisely because the id an adapter declares names the SHAPE of the
 * flow rather than the vendor: `aurora` declaring `'pix-and-card'` gets exactly
 * the component a real on-page acquirer would. A vendor-keyed registry would
 * have forced these stories to name a real vendor, which this story world
 * refuses to do (see `store-adapter.ts`).
 */
const meta: Meta = {
  title: "Checkout/Provider screens",
  parameters: {
    docs: {
      description: {
        component:
          "Each screen mounted alone, with the store config that reaches it. The last " +
          "two stories are the fallback path: a provider that declares nothing, and an " +
          "id from a newer server that this bundle has never heard of.",
      },
    },
  },
};
export default meta;

const PAYABLE_PIX: CheckoutOrder = {
  orderId: "inv_2026_0043",
  status: "AWAITING_PAYMENT",
  method: "PIX",
  totalCents: 7500,
  subtotalCents: 7500,
  discountTotalCents: 0,
  appliedDiscounts: [],
  totalLabel: "R$ 75,00",
  pix: {
    copyPaste:
      "00020126580014BR.GOV.BCB.PIX0136inv_2026_00435204000053039865802BR6009SAO PAULO62070503***6304ABCD",
    expiresAt: "2026-08-07T23:59:00.000Z",
  },
};

/** An on-page store: it can mint a card instrument in this browser. */
function onPageStore(screen: string | null): CheckoutProviderConfig {
  return {
    provider: "aurora",
    tokenization: "PUBLIC_KEY",
    publicKey: "pk_story_aurora",
    mockTokenization: true,
    methods: ["PIX", "CARD"],
    chain: [
      {
        provider: "aurora",
        tokenization: "PUBLIC_KEY",
        publicKey: "pk_story_aurora",
        mockTokenization: true,
        methods: ["PIX", "CARD"],
        checkoutScreen: screen,
      },
    ],
  };
}

/** A hand-off store: it takes a card, but never on our page. */
function handoffStore(screen: string | null): CheckoutProviderConfig {
  return {
    provider: "boreal",
    tokenization: "REDIRECT",
    publicKey: null,
    mockTokenization: false,
    methods: ["CARD"],
    chain: [
      {
        provider: "boreal",
        tokenization: "REDIRECT",
        publicKey: null,
        mockTokenization: false,
        methods: ["CARD"],
        checkoutScreen: screen,
      },
    ],
  };
}

const BUYER = { name: "Ana Souza", email: "ana@example.com", phone: "", taxId: "" };

function props(over: Partial<ProviderCheckoutScreenProps>): ProviderCheckoutScreenProps {
  return {
    order: null,
    buyer: BUYER,
    config: null,
    method: null,
    onResolved: () => undefined,
    ...over,
  };
}

/**
 * One screen, under the factory's own Provider.
 *
 * The Provider is what supplies the transport, and a PIX screen needs it: it
 * polls `/checkout/status` from the moment it mounts. Standalone, that reaches
 * the ambient `fetch` — which the render tripwire correctly fails on, and which
 * in a real host would be an unmocked request rather than the mount's own
 * client. So the stories put the screens where production puts them.
 */
function Mounted({
  screen,
  config,
  ...rest
}: {
  screen?: ProviderCheckoutScreen;
  config: CheckoutProviderConfig;
} & Partial<ProviderCheckoutScreenProps>): JSX.Element {
  return (
    <StoryFlow spec={{ chain: [{ name: config.provider ?? "aurora", stub: true }] }}>
      {(flows) => {
        const Screen = screen ?? resolveCheckoutScreen(config.chain?.[0]?.checkoutScreen);
        return (
          <flows.Provider config={config}>
            <Screen {...props({ config, ...rest })} />
          </flows.Provider>
        );
      }}
    </StoryFlow>
  );
}

export const PixCodeOnOurPage: StoryObj = {
  name: "pix-and-card — o código PIX",
  render: () => (
    <Mounted
      screen={PixAndCardScreen}
      config={onPageStore("pix-and-card")}
      method="PIX"
      order={PAYABLE_PIX}
    />
  ),
};

export const AwaitingTheMethodChoice: StoryObj = {
  name: "pix-and-card — antes da escolha",
  render: () => (
    // No payable yet: the shell is still showing the picker, and the screen
    // deliberately stays out of the way rather than reserving space.
    <Mounted screen={PixAndCardScreen} config={onPageStore("pix-and-card")} method={null} />
  ),
};

export const HandoffNotice: StoryObj = {
  name: "hosted-link — indo para a página do provedor",
  render: () => (
    // The moment this screen exists for: a method is chosen, the charge is
    // being raised, and the buyer is about to leave. Before FUT-596 the pane
    // rendered nothing here, which reads as a checkout that has stalled.
    <Mounted screen={HostedLinkScreen} config={handoffStore("hosted-link")} method="CARD" />
  ),
};

export const DeclaresNothingAndStillWorks: StoryObj = {
  name: "fallback — provedor que não declara tela",
  render: () => (
    // Stone and Stripe today. No `screen` prop: this goes through the real
    // resolution, which reads `tokenization` + `methods` and picks the same
    // shape a declaration would have.
    <Mounted config={onPageStore(null)} method="PIX" order={PAYABLE_PIX} />
  ),
};

export const UnknownIdFromANewerServer: StoryObj = {
  name: "fallback — id que este bundle não conhece",
  render: () => (
    // The version-skew case, and the reason the fallback is not decoration:
    // the two packages ship independently, so a host running a newer backend
    // publishes ids this bundle has never seen. Resolving to nothing would
    // blank the pane for every buyer of that store.
    <Mounted config={onPageStore("boleto-and-wallet")} method="PIX" order={PAYABLE_PIX} />
  ),
};

export const UnknownIdOnAHandoffStore: StoryObj = {
  name: "fallback — id desconhecido numa loja hosted",
  render: () => (
    // Same skew, other shape: the capability default must not send a hand-off
    // store to the on-page screen just because the id was unrecognised.
    <Mounted config={handoffStore("boleto-and-wallet")} method="CARD" />
  ),
};

export const CapabilityDefaultDirect: StoryObj = {
  name: "fallback — a tela de capacidade, direto",
  render: () => (
    <Mounted screen={CapabilityDefaultScreen} config={handoffStore(null)} method="CARD" />
  ),
};
