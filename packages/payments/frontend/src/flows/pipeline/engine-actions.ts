/**
 * WHAT THE ENGINE DOES WHEN A STEP ASKS (FUT-1240).
 *
 * One writer per fact, and every one of them here: choosing a method, raising
 * the payable, passing the buyer-details gate, reporting a terminal status,
 * navigating back and leaving. A step calls these; nothing else writes.
 *
 * The payable is raised in ONE place, for every settlement method. What
 * differs for a method that raises no charge is not the call — it is that the
 * engine parks nothing and treats the placement itself as the settlement, so
 * the walk goes straight to the confirmation with no pane in between.
 */
import { useCallback, useMemo } from "react";

import { buyerFieldsFor } from "../../components/checkout/buyer-fields";
import { buyerGateError } from "../../components/checkout/buyer-gate";
import { parkedBasket } from "../../components/checkout/basket";
import type { CheckoutDecline } from "../../components/checkout/decline";
import { forgetHostedOrder, rememberHostedOrder } from "../../components/checkout/hosted-return";
import { handOffMethod, offeredMethods } from "../../components/checkout/method-capability";
import type {
  BuyerInfo,
  CheckoutOrder,
  CreateOrderRequest,
  OrderStatus,
  PaymentMethod,
} from "../../components/checkout/types";
import { useCatalogExit } from "../catalog-exit";
import type { FlowsRuntime } from "../runtime";

import { applyingSteps, raisesCharge, sliceFor } from "./derive-step";
import type { EngineStore } from "./engine-state";
import { isPackageMethod } from "./methods";
import {
  BUYER_FIELD_CODE,
  DADOS_STEP_ID,
  METHOD_STEP_ID,
  dadosSliceOf,
} from "./steps";
import type {
  AnyCheckoutGate,
  AnyCheckoutStep,
  AnySettlementMethod,
  CheckoutContext,
} from "./types";

/** Everything one factory's engine closes over. Built once, never per render. */
export interface PipelineWiring {
  steps: readonly AnyCheckoutStep[];
  gates: readonly AnyCheckoutGate[];
  methods: readonly AnySettlementMethod[];
}

/**
 * The `method` the WIRE carries for a settlement this package cannot name.
 *
 * `method` is what the CHAIN can be asked to charge, so a host's registered id
 * is never one of its values: the chain's own hand-off method is what the
 * server will honour, exactly as it is for a store whose buyer was never asked.
 *
 * WHICH settlement the buyer actually chose rides {@link settlementOnWire}
 * beside it. It has to: `method` alone makes a courier, a waiter and a Pix
 * charge the same request, and `raisesCharge: false` is the capability this
 * step exists for.
 */
function wireMethod(id: string, ctx: CheckoutContext): PaymentMethod {
  return isPackageMethod(id) ? id : handOffMethod(offeredMethods(ctx.config));
}

/**
 * The chosen id, for a settlement the two package methods do not cover.
 *
 * ABSENT for `PIX` and `CARD` — a host reading only `method` reads exactly the
 * request it read before this field existed, which is the whole of the wire
 * staying additive. A step that wants to say something else still can: its
 * `contribute` returns `Partial<CreateOrderRequest>`, and the contributions are
 * folded over this base.
 */
function settlementOnWire(id: string): Pick<CreateOrderRequest, "settlementMethod"> {
  return isPackageMethod(id) ? {} : { settlementMethod: id };
}

/** The create request: the method, the buyer, and whatever each step contributes. */
function createRequest(input: {
  ctx: CheckoutContext;
  applying: readonly AnyCheckoutStep[];
  stepFacts: Readonly<Record<string, unknown>>;
  saveProfile: boolean;
  methodId: string;
}): CreateOrderRequest {
  const base: CreateOrderRequest = {
    method: wireMethod(input.methodId, input.ctx),
    buyer: input.ctx.buyer,
    saveProfile: input.saveProfile,
    ...settlementOnWire(input.methodId),
  };
  return input.applying.reduce<CreateOrderRequest>(
    (request, step) => ({
      ...request,
      ...step.contribute?.(input.ctx, input.stepFacts[step.id], sliceFor(step, input.ctx)),
    }),
    base,
  );
}

/** What the writers need from the render they were built in. */
interface EngineWritersInput {
  runtime: FlowsRuntime;
  wiring: PipelineWiring;
  store: EngineStore;
  ctx: CheckoutContext;
  stepFacts: Readonly<Record<string, unknown>>;
}

/** The engine's writers. */
interface EngineWriters {
  choose(methodId: string): void;
  place(): void;
  continueFromDados(): void;
  setBuyer(buyer: BuyerInfo): void;
  setSaveProfile(save: boolean): void;
  resolve(status: OrderStatus, decline?: CheckoutDecline | null): void;
  adoptOrder(order: CheckoutOrder): void;
  exitToCatalog(): void;
  reopen(stepId: string): void;
  openDados(): void;
  retry(): void;
}

/** Raise the payable, park it when it can be resumed, and record what came back. */
function usePlaceOrder(input: EngineWritersInput): (methodId?: string) => Promise<void> {
  const { runtime, store, ctx, wiring, stepFacts } = input;
  const saveProfile = store.state.saveProfile;
  return useCallback(
    async (methodId?: string) => {
      const chosen = methodId ?? ctx.method;
      if (chosen === null) return;
      store.patch({ placing: true, error: null, decline: null });
      // The walk is re-derived FOR THE CHOSEN METHOD, not read off the render
      // that offered the picker: a step whose `applies` asks which settlement
      // this is would otherwise be absent from the request that settles it.
      // ONE context, used for both halves. Deriving the walk against the chosen
      // method and then building the request against the un-overridden `ctx` let
      // a step's `contribute` read `ctx.method === null` on the immediate-place
      // path, which is the path a method with no Review takes — so the field
      // ADOPTING.md says a step may set "when the settlement has a finer name
      // than the tile does" was written from a context that did not know it.
      const applyingCtx = { ...ctx, method: chosen };
      const applying = applyingSteps({
        steps: wiring.steps,
        ctx: applyingCtx,
        facts: stepFacts,
        methods: wiring.methods,
      });
      const request = createRequest({
        ctx: applyingCtx,
        applying,
        stepFacts,
        saveProfile,
        methodId: chosen,
      });
      const result = await runtime.config.ports.createPayable(request);
      if (!result.ok) {
        store.patch({ placing: false, error: result.error });
        return;
      }
      const charges = raisesCharge(chosen, wiring.methods);
      // PARKED ON EVERY RAISE (FUT-1140), with the STORE and the BASKET — a
      // low-memory phone discards this tab while the shopper is in their bank
      // app. A settlement that raises no charge has nothing to come back to.
      if (charges) {
        rememberHostedOrder(result.data, {
          ...(ctx.tenantSlug === undefined ? {} : { tenantSlug: ctx.tenantSlug }),
          basket: parkedBasket(ctx.cart.identity),
          handoff: false,
        });
      }
      store.patch({
        placing: false,
        order: result.data,
        // Placing IS the settlement for a no-charge method, so its own status
        // is already the outcome — there is no pane and no poll to wait for.
        outcome: charges ? null : result.data.status,
      });
    },
    [runtime, store, ctx, wiring, stepFacts, saveProfile],
  );
}

/** "Continuar" on the buyer-details step: gate on the chain's demands, then persist. */
function useContinueFromDados(input: EngineWritersInput): () => void {
  const { runtime, store, ctx } = input;
  const copy = runtime.config.copy.views.screens.screens.validation;
  const fields = useMemo(() => buyerFieldsFor(ctx.config?.chain, null), [ctx.config]);
  return useCallback(() => {
    const complaint = buyerGateError(copy, ctx.buyer, fields, ctx.taxIdOnFile);
    if (complaint) {
      store.patch({
        error: { code: BUYER_FIELD_CODE, message: complaint.message, field: complaint.field },
      });
      return;
    }
    // The write happens HERE and not when a payment is raised: everything after
    // this step can fail, and the details must survive all of it (FUT-465).
    if (store.state.saveProfile) {
      runtime.config.ports.saveBuyerContact?.({
        ...(ctx.buyer.name === undefined ? {} : { name: ctx.buyer.name }),
        ...(ctx.buyer.phone === undefined ? {} : { phone: ctx.buyer.phone }),
        ...(ctx.buyer.taxId === undefined ? {} : { taxId: ctx.buyer.taxId }),
      });
    }
    store.setSlice(DADOS_STEP_ID, { ...dadosSliceOf(ctx), done: true });
    store.patch({ reopened: null, error: null });
  }, [copy, ctx, fields, runtime, store]);
}

/** Every writer, bound to this render's context. */
export function useEngineWriters(input: EngineWritersInput): EngineWriters {
  const { runtime, store, ctx, wiring } = input;
  const placeOrder = usePlaceOrder(input);
  const continueFromDados = useContinueFromDados(input);
  const exitToCatalog = useCatalogExit(runtime);
  const choose = useCallback(
    (methodId: string) => {
      // A different method means the order raised for the previous one is
      // gone — and the parked entry with it, scoped to THIS store so another
      // store's checkout in the same tab keeps its own.
      store.setSlice(METHOD_STEP_ID, { chosen: methodId });
      store.patch({ order: null, error: null, decline: null, reopened: null });
      forgetHostedOrder(ctx.tenantSlug);
      const descriptor = wiring.methods.find((entry) => entry.id === methodId);
      if (!descriptor?.Review) void placeOrder(methodId);
    },
    [store, ctx.tenantSlug, wiring.methods, placeOrder],
  );
  return useMemo(
    () => ({
      choose,
      continueFromDados,
      exitToCatalog,
      place: () => void placeOrder(),
      setBuyer: (buyer: BuyerInfo) =>
        store.patch({ buyer, buyerTouched: true, error: null }),
      setSaveProfile: (saveProfile: boolean) => store.patch({ saveProfile }),
      resolve: (status: OrderStatus, decline?: CheckoutDecline | null) =>
        store.patch({ outcome: status, decline: decline ?? null, reopened: null, error: null }),
      adoptOrder: (order: CheckoutOrder) => store.patch({ order, error: null }),
      reopen: (stepId: string) => store.patch({ reopened: stepId }),
      openDados: () => {
        store.setSlice(DADOS_STEP_ID, { opened: true, done: false });
        store.patch({ reopened: null, error: null });
      },
      retry: () => store.patch({ error: null, decline: null, reopened: null }),
    }),
    [choose, continueFromDados, exitToCatalog, placeOrder, store],
  );
}
