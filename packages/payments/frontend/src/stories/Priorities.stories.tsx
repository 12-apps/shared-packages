import { CircularProgress } from "@mui/material";
import { useEffect, useMemo, useState, type JSX } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import type { MerchantSettingsView } from "@12-apps/payments-backend";

// Through the PUBLISHED entry point, deliberately: a symbol dropped from
// `index.ts` should fail these stories the way it would fail a host.
import {
  createPaymentsSettingsClient,
  ProviderPriorityList,
  type PaymentsSettingsClient,
} from "../index";

import {
  createSettingsStoryStore,
  SETTINGS_BASE_URL,
  type SettingsStorySpec,
} from "./settings-store";
import type { SettingsStoryProvider } from "./settings-store-adapter";
import { SettingsStoryHost } from "./settings-story-host";

/**
 * THE FAILOVER CHAIN on its own — `ProviderPriorityList` against the same live
 * merchant mount the full-page stories run on (`settings-store.ts`).
 *
 * The order on screen is real routing configuration: checkout walks it
 * top-down, moving on only when it can prove the provider above created no
 * charge. So these stories keep the writes real too — the arrows, a drag and
 * the decline switch all go over the wire to the in-page
 * `createSettingsService` + `mountPayments` stack, and the list re-renders
 * from the SERVER's answer, never from the local guess.
 *
 * `Settings.stories.tsx` pins the chain inside the whole page; these go deeper
 * on the component's own states: whose order wins, the keyboard affordance,
 * the one-entry chain, the empty chain, the decline-cascade policy, and a
 * reorder the server refuses.
 */
const meta: Meta = {
  title: "Merchant/Failover chain",
  parameters: {
    docs: {
      description: {
        component:
          "`ProviderPriorityList` — the enabled providers in the order checkout will try " +
          "them, reorderable by drag or by the arrow buttons, with the decline-cascade " +
          "policy switch. Driven against a live `createSettingsService` + `mountPayments` " +
          "stack running in the page: every reorder is a whole-chain write, and the " +
          "server's response sets the final order.",
      },
    },
  },
};
export default meta;

interface ChainSceneProps {
  spec: SettingsStorySpec;
  /**
   * A write made from SOMEWHERE ELSE after this screen read its view — the
   * concurrent change the optimistic reorder exists to not paper over.
   */
  otherTab?: (client: PaymentsSettingsClient) => Promise<void>;
}

/**
 * The host glue `PaymentProviderSettings` normally supplies: one store, one
 * client over it, the view read once — then the component under test alone.
 */
function ChainScene({ spec, otherTab }: ChainSceneProps): JSX.Element {
  // Built once per mount, same reason as `settings-host.tsx`: a fresh client
  // every render would rebuild the merchant mid-drag.
  const client = useMemo(
    () =>
      createPaymentsSettingsClient({
        baseUrl: SETTINGS_BASE_URL,
        fetchImpl: createSettingsStoryStore(spec).fetchImpl,
      }),
    [],
  );
  const [view, setView] = useState<MerchantSettingsView | null>(null);
  useEffect(() => {
    void (async () => {
      const first = await client.getSettings();
      // The other session's write lands AFTER the read, so the list below
      // renders a view the server has already moved past.
      await otherTab?.(client);
      setView(first);
    })();
  }, [client]);
  if (!view) return <CircularProgress />;
  return (
    <SettingsStoryHost>
      <ProviderPriorityList view={view} client={client} onReordered={setView} />
    </SettingsStoryHost>
  );
}

/** One story = one merchant's chain (and, optionally, a concurrent write). */
function scene(
  name: string,
  spec: SettingsStorySpec,
  otherTab?: ChainSceneProps["otherTab"],
): StoryObj {
  return { name, render: () => <ChainScene spec={spec} otherTab={otherTab} /> };
}

// ---------------------------------------------------------------------------
// The catalog — FICTIONAL providers, all proven, so any of them may be ranked
// ---------------------------------------------------------------------------

const AURORA: SettingsStoryProvider = {
  name: "aurora",
  displayName: "Aurora Pagamentos",
  stage: "proven",
};
const BOREAL: SettingsStoryProvider = { name: "boreal", displayName: "Boreal Pay", stage: "proven" };
const INFINITO: SettingsStoryProvider = {
  name: "infinito",
  displayName: "Infinito Conta",
  stage: "proven",
};

// ---------------------------------------------------------------------------
// The order
// ---------------------------------------------------------------------------

/**
 * Three providers, and the order is the MERCHANT's: the catalog declares
 * Aurora first, but the stored priorities say Boreal — so Boreal wears the
 * "primeiro" caption and the prose above the list names it as what checkout
 * tries first. Reordering is live: an arrow (or a drag) sends the whole chain
 * to the real `setPriorities`, which re-ranks and answers with the view the
 * list re-renders from.
 */
export const MerchantOrder: StoryObj = scene("Três provedores — a ordem é a do lojista", {
  providers: [AURORA, BOREAL, INFINITO],
  chain: ["boreal", "infinito", "aurora"],
});

/**
 * The keyboard path. Dragging is what the design asks for; the ↑/↓ buttons are
 * what makes the same write reachable with a keyboard or a screen reader
 * (`Mover <nome> para cima` / `para baixo`) — neither is a fallback for the
 * other. With two rows, every edge case is on screen at once: the first row's
 * ↑ and the last row's ↓ render disabled, because the move they name does not
 * exist.
 */
export const KeyboardReorder: StoryObj = scene("Reordenar pelo teclado — as setas", {
  providers: [AURORA, BOREAL],
});

/**
 * One provider: the reorder UI does NOT hide — the row still renders with its
 * rank, the "primeiro" caption and both arrows, disabled because each is at
 * its edge. Deliberate: the box is the answer to "what will checkout try?",
 * which a single-provider store still asks; only the moves are gone.
 */
export const SingleProvider: StoryObj = scene("Um provedor só — as setas existem, desativadas", {
  providers: [AURORA],
});

/**
 * Credentials saved, probe passed — and still NO chain: "salvo" is not
 * "ativo", and the chain is derived from the enabled configs. Instead of an
 * empty list the component renders the warning that says what it means for
 * the store: checkout cannot charge until at least one provider is switched
 * on (`payments-priority-empty`).
 */
export const EmptyChain: StoryObj = scene("Nenhum provedor ativo — o aviso no lugar da fila", {
  providers: [{ ...AURORA, stage: "saved" }],
});

// ---------------------------------------------------------------------------
// The decline-cascade policy
// ---------------------------------------------------------------------------

/**
 * The business decision, switched ON: a REFUSED card is retried on the next
 * acquirer (`TECHNICAL_AND_DECLINE`), and the caption under the switch says
 * what that costs — transaction fees and fraud signals — instead of leaving
 * the merchant to discover it from their statement. Toggling writes the real
 * failover policy through the mount; the default (off) state is in the
 * stories above.
 */
export const DeclineCascade: StoryObj = scene("Recusa em cascata — a política ligada", {
  providers: [AURORA, BOREAL, INFINITO],
  chain: ["aurora", "boreal", "infinito"],
  failoverPolicy: "TECHNICAL_AND_DECLINE",
});

// ---------------------------------------------------------------------------
// The rejected reorder
// ---------------------------------------------------------------------------

/**
 * The rollback. After this screen read its view, another session switched
 * Boreal OFF — the list still shows three, because that is what it was told.
 * Drive it: press any arrow. The new order applies optimistically, the write
 * carries the stale three-name chain, and the real service REFUSES it —
 * reordering ranks the chain and may not enable a switched-off provider. The
 * list rolls back to where it was: the server's answer, not the local guess,
 * decides the final order.
 *
 * PACKAGE FINDING, documented rather than blessed: what the red alert
 * (`payments-priority-error`) then QUOTES is the refusal's raw body — an
 * English JSON envelope (`{"error":"CredentialsError","message":"Provider …
 * is not enabled; …"}`) on a pt-BR merchant screen. The rollback is the
 * intended UX; the verbatim envelope is not — `createPaymentsSettingsClient`
 * throws the response body as the error message and `ProviderPriorityList`
 * prints it, so the merchant-readable sentence is the package's to supply,
 * not this story's to fake.
 */
export const ReorderRejected: StoryObj = scene(
  "Reordenação recusada — a lista volta ao que era",
  {
    providers: [AURORA, BOREAL, INFINITO],
    chain: ["aurora", "boreal", "infinito"],
  },
  async (client) => {
    await client.setEnabled("boreal", false);
  },
);
