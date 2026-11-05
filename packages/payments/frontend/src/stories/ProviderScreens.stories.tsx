import type { JSX } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { HostedLinkScreen } from "../components/checkout/providers/hosted-link";
import type {
  ProviderCheckoutScreen,
  ProviderCheckoutScreenProps,
} from "../components/checkout/providers/types";
import type { CheckoutProviderConfig } from "../index";

import { StoryFlow } from "./host";

/**
 * The hand-off screen on its own (FUT-596).
 *
 * The one list collects Pix and the card on our page itself; what it mounts
 * from `providers/` is the screen for a store that finishes on the PROVIDER's
 * page — `hosted-link`. Every store below is a FICTIONAL provider (`boreal`):
 * the id an adapter declares names the SHAPE of the flow rather than the
 * vendor, so a story never has to name a real one (see `store-adapter.ts`).
 */
const meta: Meta = {
  title: "Checkout/Provider screens",
  parameters: {
    docs: {
      description: {
        component:
          "The hand-off screen mounted alone, with the store config that reaches it.",
      },
    },
  },
};
export default meta;

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
        // The name a BUYER reads. Published per chain entry so the hand-off
        // screen can say where it is sending them; a host that serves none
        // gets the provider-neutral sentence instead.
        displayName: "Boreal",
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
  screen: ProviderCheckoutScreen;
  config: CheckoutProviderConfig;
} & Partial<ProviderCheckoutScreenProps>): JSX.Element {
  return (
    <StoryFlow spec={{ chain: [{ name: config.provider ?? "aurora", stub: true }] }}>
      {(flows) => {
        const Screen = screen;
        return (
          <flows.Provider config={config}>
            <Screen {...props({ config, ...rest })} />
          </flows.Provider>
        );
      }}
    </StoryFlow>
  );
}

export const HandoffNotice: StoryObj = {
  name: "hosted-link — indo para a página do provedor",
  render: () => (
    // The moment after the press of the list's "Ir para …": the charge is
    // being raised and the buyer is about to leave.
    <Mounted screen={HostedLinkScreen} config={handoffStore("hosted-link")} method="CARD" />
  ),
};
