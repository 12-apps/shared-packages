/**
 * THE ENGINE (FUT-1240) — a checkout whose current step is DERIVED rather than
 * remembered.
 *
 * It owns four things and nothing else: the order the plugins run in, the
 * state a step reads, the walk (`derive-step.ts`), and the one rule no lane is
 * allowed to restate — a settlement method that raises no charge mounts no
 * payment surface. Every pixel below belongs to a step, a gate or a registered
 * method.
 *
 * ## Hook order is a property of the ARRAYS
 *
 * Every plugin's `useFacts()` runs here, on every render, in array order —
 * which is what lets a plugin read the host's own hooks at all, and why the
 * arrays must be identity-stable. The `map`s below are hook calls in a loop on
 * purpose; `stable-plugins.ts` is what makes the loop's length a constant, and
 * it says so loudly in a development build when a host makes it one.
 */
import { Box } from "@mui/material";
import { useEffect, useMemo, useState, type JSX, type ReactNode } from "react";

import { forgetHostedOrder } from "../../components/checkout/hosted-return";
import type { SettlementCheckout } from "../../components/checkout/types";
import type { CheckoutViewCopy } from "../../components/checkout/view-copy";
import { FlowsProvider, type FlowsRuntime } from "../runtime";
import { storeCannotCharge } from "../screens-pay";
import type { CheckoutScreens, PaymentFlows } from "../types";

import { PipelineActionsProvider, type PipelineActions } from "./actions";
import { decideAdmission, resumePending } from "./admission";
import { useCheckoutBase, withCheckoutState } from "./context";
import { deriveNav, deriveStep, raisesCharge, sliceFor } from "./derive-step";
import { useEngineWriters, type PipelineWiring } from "./engine-actions";
import { EngineChrome, EngineLoading } from "./engine-chrome";
import { effectiveBuyer, useEngineStore } from "./engine-state";
import { PACKAGE_METHODS } from "./methods";
import { errorForStep, refusalOwner, refusalStepOverride } from "./refusal-routing";
import { clearSlices } from "./slices";
import { useStablePluginArray } from "./stable-plugins";
import { methodSliceOf, packageSteps } from "./steps";
import type { AnyCheckoutGate, CheckoutContext, GateVerdict } from "./types";

/** A host that registered no gates admits everyone. Frozen: this array IS hook order. */
const NO_GATES: readonly AnyCheckoutGate[] = Object.freeze([]);

/** One plugin list's facts, in array order. */
function usePluginFacts(plugins: readonly { useFacts?(): unknown }[]): readonly unknown[] {
  return plugins.map((plugin) => plugin.useFacts?.());
}

/** The same facts, addressed by id — how the walk reads them. */
function byId(
  plugins: readonly { id: string }[],
  facts: readonly unknown[],
): Record<string, unknown> {
  const table: Record<string, unknown> = {};
  plugins.forEach((plugin, at) => {
    table[plugin.id] = facts[at];
  });
  return table;
}

/**
 * The end of a checkout: let the parked entry and the parked slices go.
 *
 * Storage only — the React slices stay for the rest of this visit, so the
 * confirmation still knows which method it is confirming. What must not
 * survive is the NEXT mount finding a finished walk parked and skipping the
 * steps a new purchase needs.
 */
function useSettled(input: {
  ctx: CheckoutContext;
  wiring: PipelineWiring;
  runtime: FlowsRuntime;
}): void {
  const { ctx, wiring, runtime } = input;
  const { outcome, order, tenantSlug } = ctx;
  // AWAITING_PAYMENT is TERMINAL for a settlement that raises no charge:
  // nothing is coming to confirm, because placing the order was the whole of it.
  const charges = raisesCharge(ctx.method, wiring.methods);
  const settled = outcome !== null && (outcome !== "AWAITING_PAYMENT" || !charges);
  const onSettled = runtime.config.onSettled;
  const onPaid = runtime.config.ports.onPaid;
  const steps = wiring.steps;
  useEffect(() => {
    if (!settled || outcome === null) return;
    forgetHostedOrder(tenantSlug);
    clearSlices(steps, tenantSlug);
    // PAID only: a FAILED or EXPIRED shopper still has a basket to retry with,
    // and the host must not be told otherwise.
    if (outcome === "PAID") onPaid?.();
    if (order) onSettled?.(outcome, order);
  }, [settled, outcome, order, tenantSlug, steps, onPaid, onSettled]);
}

/** The walk, once admission has passed. Split out for the size gate. */
function EngineWalk(props: {
  runtime: FlowsRuntime;
  screens: CheckoutScreens;
  wiring: PipelineWiring;
  ctx: CheckoutContext;
  store: ReturnType<typeof useEngineStore>;
  stepFacts: Readonly<Record<string, unknown>>;
  offered: PipelineActions["offered"];
}): ReactNode {
  const { runtime, screens, wiring, ctx, store, stepFacts, offered } = props;
  const owner = refusalOwner(store.state.error?.code, wiring.steps, wiring.gates);
  const derived = deriveStep({
    steps: wiring.steps,
    ctx,
    facts: stepFacts,
    methods: wiring.methods,
    reopened: refusalStepOverride(store.state.error, owner) ?? store.state.reopened,
  });
  const writers = useEngineWriters({ runtime, wiring, store, ctx, stepFacts });
  const nav = deriveNav({
    applying: derived.applying,
    index: derived.index,
    taxIdOnFile: ctx.taxIdOnFile,
    terminal: ctx.outcome !== null,
    ports: writers,
  });
  const copy = runtime.config.copy.views;
  const actions = usePipelineActionsValue({
    screens,
    copy,
    wiring,
    offered,
    store,
    writers,
    editBuyer: nav.editBuyer,
  });
  const step = derived.step;
  return (
    <PipelineActionsProvider actions={actions}>
      <Box sx={{ display: "flex", flexDirection: "column", gap: { xs: 2, sm: 3 } }}>
        <EngineChrome
          copy={copy}
          applying={derived.applying}
          currentId={step?.id ?? null}
          first={derived.index <= 0}
          onBack={nav.back}
        />
        {step === null ? (
          <EngineLoading copy={copy} />
        ) : (
          step.render({
            ctx,
            facts: stepFacts[step.id],
            slice: sliceFor(step, ctx),
            setSlice: (value: unknown) => store.setSlice(step.id, value),
            advance: () => store.patch({ reopened: null }),
            back: nav.back,
            error: errorForStep(store.state.error, owner, step.id, step.id),
          })
        )}
      </Box>
    </PipelineActionsProvider>
  );
}

/** What a step's render reads, assembled once per render. */
function usePipelineActionsValue(input: {
  screens: CheckoutScreens;
  copy: CheckoutViewCopy;
  wiring: PipelineWiring;
  offered: PipelineActions["offered"];
  store: ReturnType<typeof useEngineStore>;
  writers: ReturnType<typeof useEngineWriters>;
  editBuyer: (() => void) | undefined;
}): PipelineActions {
  const { screens, copy, wiring, offered, store, writers, editBuyer } = input;
  return useMemo<PipelineActions>(
    () => ({
      screens,
      copy,
      methods: wiring.methods,
      offered,
      placing: store.state.placing,
      saveProfile: store.state.saveProfile,
      error: store.state.error,
      editBuyer,
      choose: writers.choose,
      place: writers.place,
      continueFromDados: writers.continueFromDados,
      setBuyer: writers.setBuyer,
      setSaveProfile: writers.setSaveProfile,
      resolve: writers.resolve,
      adoptOrder: writers.adoptOrder,
      exitToCatalog: writers.exitToCatalog,
    }),
    [screens, copy, wiring.methods, offered, store.state, editBuyer, writers],
  );
}

/**
 * Whether a hand-off from this tab was still waiting WHEN THIS CHECKOUT
 * MOUNTED.
 *
 * Asked once, and the "once" is the whole of it. The resume CONSUMES the
 * parked entry — that is what makes a resume happen exactly once — so a second
 * read a render later answers "nothing is pending" about the very shopper
 * being resumed. Every caller of this answer would then flip mid-visit: gates
 * that stood aside would close, and the empty-cart screen would land on top of
 * a confirmation for money that already moved.
 */
function useResumePending(ctx: CheckoutContext): boolean {
  const [pending] = useState(() => resumePending(ctx));
  return pending;
}

/** The engine body: facts, admission, state, then the walk. */
function EngineBody(props: {
  runtime: FlowsRuntime;
  screens: CheckoutScreens;
  wiring: PipelineWiring;
  settlement?: SettlementCheckout | null;
}): ReactNode {
  const { runtime, screens, wiring } = props;
  useStablePluginArray("steps", runtime.config.steps);
  useStablePluginArray("gates", runtime.config.gates);
  useStablePluginArray("settlementMethods", runtime.config.settlementMethods);
  const base = useCheckoutBase(runtime, runtime.config);
  const stepFactList = usePluginFacts(wiring.steps);
  const gateFacts = usePluginFacts(wiring.gates);
  const methodFacts = usePluginFacts(wiring.methods);
  const store = useEngineStore(wiring.steps, base.ctx);
  const stepFacts = byId(wiring.steps, stepFactList);
  // Whatever order this visit is about, in the same priority the context
  // resolves: the one just raised, then the one the host's open-payable read
  // or the park answered with.
  const inFlight = store.state.order ?? base.ctx.order;
  const ctx = withCheckoutState(
    { ...base.ctx, settlement: props.settlement ?? base.ctx.settlement },
    {
      buyer: effectiveBuyer(store.state, base.ctx.buyer),
      // ONE writer: the chosen method IS the method step's slice. An order
      // this shopper never chose for — resumed from a park, or answered by
      // the server's own open payable — speaks for itself, which is what puts
      // them back in front of the pane that still has what they need.
      method: methodSliceOf(store.state.slices).chosen ?? inFlight?.method ?? null,
      order: store.state.order,
      outcome: store.state.outcome,
      slices: store.state.slices,
    },
  );
  const offered = wiring.methods.filter((method, at) => method.offered(ctx, methodFacts[at]));
  useSettled({ ctx, wiring, runtime });
  const resuming = useResumePending(ctx);
  const admission = decideAdmission({ gates: wiring.gates, facts: gateFacts, ctx, resuming });
  const refused = admittedOrScreen(admission, ctx, store, runtime.config.copy.views);
  if (refused !== null) return refused;
  if (storeCannotCharge(ctx.config, ctx.configPending, runtime.useAvailability().payable)) {
    return <screens.PaymentsUnavailable />;
  }
  if (nothingToPayFor(ctx, resuming)) return <screens.EmptyCart />;
  return (
    <EngineWalk
      runtime={runtime}
      screens={screens}
      wiring={wiring}
      ctx={ctx}
      store={store}
      stepFacts={stepFacts}
      offered={offered}
    />
  );
}

/** A gate's verdict, as something to render — or `null` to carry on. */
function admittedOrScreen(
  admission: GateVerdict,
  ctx: CheckoutContext,
  store: ReturnType<typeof useEngineStore>,
  copy: CheckoutViewCopy,
): ReactNode {
  if (admission.kind === "pass") return null;
  // PENDING is not a refusal: a gate that has not heard back yet must not put
  // a curtain in front of a shopper it may be about to admit.
  if (admission.kind === "pending") return <EngineLoading copy={copy} />;
  const Screen = admission.Screen;
  return (
    <Screen
      ctx={ctx}
      error={store.state.error}
      retry={() => store.patch({ error: null, decline: null, reopened: null })}
    />
  );
}

/**
 * Nothing to check out — and the cart has ANSWERED, which is the half FUT-1213
 * added. A settlement pays already-sent items, so its cart is legitimately
 * empty; and the guard holds only until an order exists, after which the
 * order's own lines speak for it.
 *
 * It also stands aside for a shopper coming back from a payment, and that
 * clause is load-bearing rather than defensive: the server empties a paid
 * cart, so an EMPTY basket is exactly what a buyer who paid comes back to.
 * Without it the one shopper whose confirmation matters most would meet "seu
 * carrinho está vazio" instead of the receipt for the money they just sent —
 * the flat flow avoids that only by resuming inside a LAYOUT effect, which a
 * derived walk has no equivalent of.
 */
function nothingToPayFor(ctx: CheckoutContext, resuming: boolean): boolean {
  if (resuming || ctx.settlement || !ctx.cart.empty) return false;
  if (ctx.cart.identity?.ready === false) return false;
  return ctx.order === null && ctx.outcome === null;
}

/** What `createPaymentFlows` mounts when a host asked for the pipeline. */
interface PipelineBundle {
  Checkout: PaymentFlows["Checkout"];
  useAdmission(): GateVerdict;
}

/**
 * Build one factory's engine.
 *
 * Every array here is a FACTORY-SCOPE constant — the package's own steps and
 * methods merged once with the host's — because hook order is a function of
 * their membership. A host that hands over a fresh array per render is told
 * so, loudly, in a development build.
 */
export function buildPipeline(
  runtime: FlowsRuntime,
  screens: CheckoutScreens,
): PipelineBundle {
  const methods = Object.freeze([
    ...PACKAGE_METHODS,
    ...(runtime.config.settlementMethods ?? []),
  ]);
  const wiring: PipelineWiring = {
    methods,
    steps: Object.freeze([
      ...packageSteps(runtime, methods),
      ...(runtime.config.steps ?? []),
    ]),
    gates: runtime.config.gates ?? NO_GATES,
  };

  function Checkout({ settlement }: { settlement?: SettlementCheckout | null }): JSX.Element {
    return (
      <FlowsProvider runtime={runtime}>
        <EngineBody
          runtime={runtime}
          screens={screens}
          wiring={wiring}
          {...(settlement === undefined ? {} : { settlement })}
        />
      </FlowsProvider>
    );
  }

  /**
   * The same gate list, headless — so the cart drawer's CTA and a buy-now
   * button consume the answer the checkout will give rather than a second
   * one of their own.
   */
  function useAdmission(): GateVerdict {
    useStablePluginArray("gates", runtime.config.gates);
    const base = useCheckoutBase(runtime, runtime.config);
    const facts = usePluginFacts(wiring.gates);
    const resuming = useResumePending(base.ctx);
    return decideAdmission({ gates: wiring.gates, facts, ctx: base.ctx, resuming });
  }

  return { Checkout, useAdmission };
}
