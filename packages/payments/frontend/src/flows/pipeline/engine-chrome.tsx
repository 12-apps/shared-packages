/**
 * THE ENGINE'S OWN CHROME (FUT-1240) — the two things that are not a step.
 *
 * A back control and a progress header, both reproducing the flat flow's
 * pixels and test ids exactly: `checkout-back` and `checkout-stepper` are the
 * hooks the storefront journeys click, and a walk that renders different ones
 * would be a rewrite wearing a refactor's clothes.
 *
 * The stepper's nodes are DERIVED like everything else: the applying steps
 * that named a label, in walk order. A step with no label is an interstitial —
 * the hand-off and the resume are not places a shopper is asked to be.
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
  /** The shopper is on the first applying step, so back leaves for the catalog. */
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
