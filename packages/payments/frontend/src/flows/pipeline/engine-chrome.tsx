/**
 * THE ENGINE'S OWN CHROME (FUT-1240) — the two things that are not a step.
 *
 * A back control and a progress header, at the flat flow's own TEST IDS:
 * `checkout-back` and `checkout-stepper` are the hooks the storefront journeys
 * click, and a walk that renders different ones would be a rewrite wearing a
 * refactor's clothes.
 *
 * ## What is NOT the flat flow's, and deliberately
 *
 * The flat `ProgressHeader` renders three FIXED nodes — Dados, Pagamento,
 * Confirmação — for every shopper. Here the nodes are DERIVED like everything
 * else: the applying steps that named a label, in walk order. So a shopper with
 * a CPF on file, whose Dados step is not part of their walk at all (FUT-465),
 * sees the steps they will actually be asked for rather than one they will
 * never be shown. The same derivation is what lets a host's registered step
 * appear in the stepper without the header knowing it exists.
 *
 * A step with no label is an interstitial — the hand-off and the resume are not
 * places a shopper is asked to be — so those draw no node either.
 *
 * The back link's wording follows the same derivation: it offers "keep
 * shopping" on the FIRST applying step, where back leaves for the catalog,
 * rather than on the id `dados` specifically.
 */
import { Box } from "@mui/material";
import type { JSX } from "react";

import { ArrowBackIcon } from "../../components/checkout/icons";
import { useCheckoutComponents } from "../../components/checkout/ui";
import type { CheckoutViewCopy } from "../../components/checkout/view-copy";

import type { AnyCheckoutStep } from "./types";

/** The stepper nodes: applying steps that named a label, already worded. */
function stepperNodes(
  applying: readonly AnyCheckoutStep[],
  copy: CheckoutViewCopy,
): { id: string; label: string }[] {
  const nodes: { id: string; label: string }[] = [];
  for (const step of applying) {
    const label = step.label;
    if (typeof label !== "string") continue;
    nodes.push({ id: step.id, label: copy.steps[label] });
  }
  return nodes;
}

/** The slim header: the walk's only nav, and it is step-aware. */
export function EngineChrome({
  copy,
  applying,
  currentId,
  first,
  onBack,
}: {
  copy: CheckoutViewCopy;
  applying: readonly AnyCheckoutStep[];
  currentId: string | null;
  /**
   * The shopper is on the first applying step, which is where the link is
   * worded "continuar comprando" rather than "voltar".
   *
   * It is about the WORDING only. Where back actually goes is `deriveNav`'s,
   * and it leaves for the catalog from a settled confirmation too — where the
   * flat flow also says "voltar" and also goes to the menu.
   */
  first: boolean;
  onBack(): void;
}): JSX.Element {
  const { Button, Stepper } = useCheckoutComponents();
  const nodes = stepperNodes(applying, copy);
  const at = nodes.findIndex((node) => node.id === currentId);
  const completed = new Set(nodes.slice(0, Math.max(at, 0)).map((node) => node.id));
  return (
    <>
      <Box sx={{ minHeight: 36, display: "flex", alignItems: "center", gap: 1 }}>
        <Button
          variant="text"
          color="neutral"
          size="sm"
          icon={<ArrowBackIcon fontSize="small" />}
          iconPosition="left"
          onClick={onBack}
          dataTestId="checkout-back"
        >
          {first ? copy.dados.keepShopping : copy.dados.back}
        </Button>
      </Box>
      {nodes.length === 0 ? null : (
        <Box sx={{ height: 50, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <Stepper
            steps={nodes}
            activeId={currentId ?? ""}
            completed={completed}
            orientation="horizontal"
            size="sm"
            data-testid="checkout-stepper"
          />
        </Box>
      )}
    </>
  );
}

/**
 * Nothing to show yet — a gate still deciding, the store's protocol still in
 * flight, or a walk with no applying step.
 *
 * It exists because the alternative is a blank frame, and a shopper who taps
 * "pagar" and gets an empty page taps again.
 */
export function EngineLoading({ copy }: { copy: CheckoutViewCopy }): JSX.Element {
  const { LoadingState } = useCheckoutComponents();
  return (
    <LoadingState
      variant="spinner"
      size="md"
      message={copy.pipeline.loading}
      dataTestId="checkout-pipeline-loading"
    />
  );
}
