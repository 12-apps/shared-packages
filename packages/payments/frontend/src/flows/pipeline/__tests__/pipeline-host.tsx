/**
 * A HOST for the pipeline suites — the same amount of glue an adopter writes.
 *
 * Nothing here is part of the package. The transport is stubbed at `/config`
 * (the one read `Checkout` makes on mount) and the create port is a spy, so a
 * suite can assert what the engine asked for without standing up a mount the
 * wire contracts already cover elsewhere.
 */
import { vi, type Mock } from "vitest";

import { PT_BR_CHECKOUT_VIEW_COPY } from "../../../components/checkout/pt-BR";
import type {
  CheckoutProviderConfig,
  CreateOrderRequest,
  CreateOrderResult,
} from "../../../components/checkout/types";
import { STORY_CHECKOUT_COPY } from "../../../stories/demo-copy";
import { createPaymentFlows } from "../../create-payment-flows";
import type { PaymentFlows, PaymentFlowsConfig } from "../../types";

import { orderOf } from "./fixtures";

/** A store with both in-browser methods and a stub tokenizer. */
export const STUB_CONFIG: CheckoutProviderConfig = {
  provider: "stub",
  tokenization: "PUBLIC_KEY",
  publicKey: "pk-stub",
  mockTokenization: true,
  methods: ["PIX", "CARD"],
  chain: [
    {
      provider: "stub",
      tokenization: "PUBLIC_KEY",
      publicKey: "pk-stub",
      mockTokenization: true,
      methods: ["PIX", "CARD"],
    },
  ],
};

/** Answer `/config` and nothing else — anything unexpected is a test bug. */
function stubFetch(config: CheckoutProviderConfig | null): typeof fetch {
  const impl = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.includes("/config")) {
      return new Response(JSON.stringify({ data: config }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/status")) {
      return new Response(JSON.stringify({ data: "AWAITING_PAYMENT" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/cards")) {
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
  };
  return impl as typeof fetch;
}

/** What a suite may vary about the host. */
interface HostOptions {
  tenantSlug?: string;
  taxIdOnFile?: boolean;
  empty?: boolean;
  navigate?: (url: string) => void;
  createPayable?: (input: CreateOrderRequest) => Promise<CreateOrderResult>;
  config?: CheckoutProviderConfig | null;
}

/** One factory, plus the ports a suite asserts on. */
interface PipelineHost {
  flows: PaymentFlows;
  createPayable: Mock<(input: CreateOrderRequest) => Promise<CreateOrderResult>>;
  exitToCatalog: Mock<() => void>;
  saveBuyerContact: Mock<() => void>;
}

/** Build a factory with whatever pipeline config the suite is about. */
export function buildHost(
  pipeline: Partial<PaymentFlowsConfig> = {},
  host: HostOptions = {},
): PipelineHost {
  const createPayable = vi.fn(
    host.createPayable ??
      (async (input: CreateOrderRequest): Promise<CreateOrderResult> => ({
        ok: true,
        data: orderOf({ method: input.method, pix: { copyPaste: "0002", expiresAt: "2099-01-01" } }),
      })),
  );
  const exitToCatalog = vi.fn<() => void>();
  const saveBuyerContact = vi.fn<() => void>();
  const base: PaymentFlowsConfig = {
    transport: { fetchImpl: stubFetch(host.config === undefined ? STUB_CONFIG : host.config) },
    useScope: () => ({ tenantSlug: host.tenantSlug ?? "loja-1" }),
    useCart: () => ({
      empty: host.empty ?? false,
      totalLabel: "R$ 7,00",
      totalItems: 1,
    }),
    useBuyerDefaults: () => ({ taxIdOnFile: host.taxIdOnFile ?? false }),
    copy: { ...STORY_CHECKOUT_COPY, views: PT_BR_CHECKOUT_VIEW_COPY },
    ports: {
      createPayable,
      saveBuyerContact,
      exitToCatalog,
      navigate: host.navigate ?? (() => undefined),
    },
  };
  // COPIED AS DESCRIPTORS, not spread. A spread reads a getter once and freezes
  // its answer, which would quietly turn the very host shape the identity
  // assertion exists to catch — a config that COMPUTES its plugin list — into a
  // stable array before the engine ever sees it.
  Object.defineProperties(base, Object.getOwnPropertyDescriptors(pipeline));
  const flows = createPaymentFlows(base);
  return { flows, createPayable, exitToCatalog, saveBuyerContact };
}
