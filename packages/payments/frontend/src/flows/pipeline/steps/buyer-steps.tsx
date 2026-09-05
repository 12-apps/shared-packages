/**
 * THE TWO STEPS BEFORE ANY MONEY MOVES (FUT-1240): who is paying, and how.
 *
 * Both are thin wrappers over screens this package already ships — exactly as
 * `flows/screens-*.tsx` wrap the components today. What is new is that their
 * PLACE in the walk is declared rather than switched on, and that the
 * buyer-details step's "was it skipped, and has it been opened since" lives in
 * a slice the engine parks instead of in a `useState` a reload forgets.
 */
import { Box } from "@mui/material";
import type { JSX } from "react";

import { PaymentErrorPanel } from "../../../components/checkout/payment-error-panel";
import { useCheckoutComponents } from "../../../components/checkout/ui";
import type { PaymentMethod } from "../../../components/checkout/types";
import { usePipelineActions } from "../actions";
import { isPackageMethod } from "../methods";
import type {
  AnySettlementMethod,
  CheckoutContext,
  CheckoutStep,
  CheckoutStepRender,
} from "../types";

export const DADOS_STEP_ID = "dados";
export const METHOD_STEP_ID = "method";

/**
 * The server's own code for "the chain asked for a field this buyer has not
 * given" — and the code the local gate raises, so a refusal the browser can
 * see and one the server sends land on the same step, worded the same way.
 */
export const BUYER_FIELD_CODE = "MISSING_BUYER_FIELD";

/** Whether the shopper has opened the buyer-details step, and finished it. */
interface DadosSlice {
  /**
   * A shopper whose CPF is on file never sees this step — until they press
   * "alterar", after which it IS part of their flow and back returns to it.
   * That is the whole of `useCheckoutNav`'s `dadosOpened`.
   */
  opened: boolean;
  done: boolean;
}

const DADOS_INITIAL: DadosSlice = Object.freeze({ opened: false, done: false });

/** Trust nothing out of storage: two booleans, or nothing at all. */
export function parseDadosSlice(raw: unknown): DadosSlice | null {
  if (typeof raw !== "object" || raw === null) return null;
  const candidate = raw as Partial<DadosSlice>;
  if (typeof candidate.opened !== "boolean") return null;
  if (typeof candidate.done !== "boolean") return null;
  return { opened: candidate.opened, done: candidate.done };
}

/** The buyer-details slice as the whole walk reads it. */
export function dadosSliceOf(ctx: CheckoutContext): DadosSlice {
  return parseDadosSlice(ctx.slices[DADOS_STEP_ID]) ?? DADOS_INITIAL;
}

function DadosView({ ctx, error }: CheckoutStepRender<DadosSlice>): JSX.Element {
  const actions = usePipelineActions();
  const BuyerDetails = actions.screens.BuyerDetails;
  const field = error?.field ?? null;
  return (
    <BuyerDetails
      value={ctx.buyer}
      onChange={actions.setBuyer}
      method={isPackageMethod(ctx.method) ? ctx.method : null}
      onContinue={actions.continueFromDados}
      error={field && error ? { field, message: error.message } : null}
    />
  );
}

/**
 * WHO IS PAYING.
 *
 * `applies` is the FUT-465 skip, stated as a fact rather than as an initial
 * step: a shopper with a CPF on file has nothing left to answer here, so the
 * step is not part of their walk — which is also why back off the next step
 * takes them to the catalog rather than to a form they never saw.
 */
export const dadosStep: CheckoutStep<DadosSlice> = {
  id: DADOS_STEP_ID,
  phase: "details",
  order: 0,
  label: "dados",
  applies(ctx) {
    return !ctx.taxIdOnFile || dadosSliceOf(ctx).opened;
  },
  complete(_ctx, _facts, slice) {
    return slice.done;
  },
  slice: {
    initial: () => DADOS_INITIAL,
    persist: "session",
    parse: parseDadosSlice,
  },
  // The two refusals that are ABOUT a field on this form. Anything else the
  // create can answer is not something retyping a name will fix.
  answersCodes: [BUYER_FIELD_CODE, "EMAIL_EQUALS_MERCHANT"],
  contribute(ctx) {
    return { buyer: ctx.buyer };
  },
  render(props) {
    return <DadosView {...props} />;
  },
};

/** Which settlement method the shopper picked. */
interface MethodSlice {
  chosen: string | null;
}

const METHOD_INITIAL: MethodSlice = Object.freeze({ chosen: null });

/** A method id is a string or nothing — never an object a shopper edited in. */
function parseMethodSlice(raw: unknown): MethodSlice | null {
  if (typeof raw !== "object" || raw === null) return null;
  const chosen = (raw as Partial<MethodSlice>).chosen;
  if (chosen === null) return { chosen: null };
  return typeof chosen === "string" ? { chosen } : null;
}

/** The chosen method, as the engine reads it back out of the slices. */
export function methodSliceOf(slices: Readonly<Record<string, unknown>>): MethodSlice {
  return parseMethodSlice(slices[METHOD_STEP_ID]) ?? METHOD_INITIAL;
}

/** One registered method as a tile, for the methods the package cannot draw. */
function MethodTiles({ ctx }: { ctx: CheckoutContext }): JSX.Element {
  const { Button, Text } = useCheckoutComponents();
  const actions = usePipelineActions();
  return (
    <Box role="radiogroup" data-testid="checkout-method" sx={{ display: "flex", gap: 1 }}>
      {actions.offered.map((method) => {
        const tile = method.tile(actions.copy);
        return (
          <Box key={method.id} sx={{ flex: 1, minWidth: 0 }}>
            <Button
              variant={ctx.method === method.id ? "solid" : "outline"}
              color="primary"
              size="md"
              fullWidth
              onClick={() => actions.choose(method.id)}
              dataTestId={`checkout-method-${method.id}`}
            >
              {tile.label}
            </Button>
            {tile.hint === undefined ? null : (
              <Text variant="caption" size="xs" color="secondary" as="p">
                {tile.hint}
              </Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

/**
 * HOW they are paying.
 *
 * The package's own picker renders whenever the offer is the package's own two
 * methods — with its disabled-card caption and its sole-method preselect
 * intact, because those are decisions about PIX and CARD specifically. A host
 * that registers a method of its own gets the generic tiles, which is the only
 * shape that can draw a method this package has never heard of.
 */
function MethodView({ ctx, error }: CheckoutStepRender<MethodSlice>): JSX.Element {
  const actions = usePipelineActions();
  const MethodChoice = actions.screens.MethodChoice;
  const packageOnly = actions.offered.every((method) => isPackageMethod(method.id));
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <PayerBlock ctx={ctx} />
      {packageOnly ? (
        <MethodChoice
          value={isPackageMethod(ctx.method) ? ctx.method : null}
          onChange={(method: PaymentMethod) => actions.choose(method)}
        />
      ) : (
        <MethodTiles ctx={ctx} />
      )}
      <MethodRefusal error={error} />
    </Box>
  );
}

/**
 * A REFUSAL THE PICKER HAS TO DRAW, because it is where the shopper is.
 *
 * The routing hands a step every refusal nobody more specific claimed — the
 * unclaimed ones, and the ones whose gate is passing and therefore drawing
 * nothing (`refusal-routing.ts`). Raising the payable fails from HERE, so this
 * is the step those land on, and a picker that ignored the prop would leave the
 * shopper tapping a tile that answers nothing.
 *
 * `PaymentErrorPanel` rather than a bare Alert: it is the same panel the flat
 * flow's Pagamento step draws, and it carries the rule that matters most — an
 * UNRESOLVED charge gets a warning and NO retry, because some provider may be
 * holding the buyer's money and a retry mints a second order.
 *
 * `emailFlagged` is FALSE here and cannot be otherwise: the one refusal that
 * offer answers, `EMAIL_EQUALS_MERCHANT`, is claimed by the buyer-details step
 * (`dadosStep.answersCodes`), so the routing sends that shopper to the form
 * holding the e-mail field instead of offering a second copy of it under a
 * picker. `onUseEmail` is consequently unreachable, and is the buyer-details
 * door rather than a no-op so that it stays true if the claim ever moves.
 */
function MethodRefusal({ error }: { error: CheckoutStepRender<MethodSlice>["error"] }): JSX.Element | null {
  const actions = usePipelineActions();
  const openDados = actions.editBuyer;
  if (!error) return null;
  return (
    <PaymentErrorPanel
      message={error.message}
      emailFlagged={false}
      code={error.code}
      onUseEmail={() => openDados?.()}
      onRetry={actions.place}
    />
  );
}

/**
 * WHO IS BEING CHARGED, and the door back to changing it.
 *
 * Drawn only for a shopper whose buyer-details step was SKIPPED — the same
 * rule the flat flow applies, and for the same reason: a shopper who filled
 * the form themselves is looking at what they just typed, and a summary of it
 * is a second copy of the same screen. Its presence is `editBuyer`'s presence,
 * which the engine derives once (`deriveNav`) rather than each caller guessing.
 */
function PayerBlock({ ctx }: { ctx: CheckoutContext }): JSX.Element | null {
  const actions = usePipelineActions();
  const PayerSummary = actions.screens.PayerSummary;
  if (!actions.editBuyer) return null;
  return <PayerSummary buyer={ctx.buyer} onEdit={actions.editBuyer} />;
}

/** A chosen method whose descriptor wants a review has not finished this step. */
function methodSettled(ctx: CheckoutContext, methods: readonly AnySettlementMethod[]): boolean {
  if (ctx.method === null) return false;
  const descriptor = methods.find((entry) => entry.id === ctx.method);
  if (descriptor?.Review && ctx.order === null) return false;
  return true;
}

/** Built over the MERGED descriptor list, which is a factory-scope constant. */
export function buildMethodStep(
  methods: readonly AnySettlementMethod[],
): CheckoutStep<MethodSlice> {
  return {
    id: METHOD_STEP_ID,
    phase: "before-pay",
    order: 0,
    label: "payment",
    applies(ctx) {
      return ctx.outcome === null;
    },
    complete(ctx) {
      return methodSettled(ctx, methods);
    },
    slice: {
      initial: () => METHOD_INITIAL,
      persist: "session",
      parse: parseMethodSlice,
    },
    render(props) {
      return <MethodStepBody {...props} methods={methods} />;
    },
  };
}

/** The picker, or the chosen descriptor's own review of what is about to happen. */
function MethodStepBody(
  props: CheckoutStepRender<MethodSlice> & { methods: readonly AnySettlementMethod[] },
): JSX.Element {
  const actions = usePipelineActions();
  const descriptor = props.methods.find((entry) => entry.id === props.ctx.method);
  const Review = descriptor?.Review;
  if (Review && props.ctx.order === null) {
    return (
      <Review
        ctx={props.ctx}
        place={actions.place}
        placing={actions.placing}
        error={props.error}
      />
    );
  }
  return <MethodView {...props} />;
}
