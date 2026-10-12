import { Box } from "@mui/material";
import { useMemo, type JSX, type ReactNode } from "react";

import { useCheckoutCopy } from "./copy-context";
import { ArrowBackIcon } from "./icons";
import { CheckoutLayoutProvider, STEP_COLUMN_MAX, useCheckoutLayout, useWideLayout } from "./payment-step-layout";
import { useCheckoutComponents } from "./ui";
import type { CheckoutViewCopy } from "./view-copy";

/**
 * The flow's frame and header: measured once at the host's full width
 * (FUT-3525), so every step agrees on whether this is the computer's layout or
 * the phone's.
 */

/** Step ids are the flow's own contract; the labels beside them are host copy. */
function stepperSteps(copy: CheckoutViewCopy): { id: string; label: string }[] {
  return [
    { id: "dados", label: copy.steps.dados },
    { id: "payment", label: copy.steps.payment },
    { id: "status", label: copy.steps.status },
  ];
}

/**
 * The slim checkout header — the flow's only nav: a step-aware back link
 * (Pagamento → Dados, else the menu).
 *
 * Deliberately nothing else. A "limpar carrinho" trash used to sit on the right
 * of the Dados step; it was removed because emptying the cart is a CART action
 * and belongs where the cart is edited — the drawer, which already offers a
 * per-line remove. Offering it here put a destructive control next to the form
 * a buyer is filling in, one tap away from the field they are typing into.
 */
function CheckoutHeader({ copy, step, onBack }: { copy: CheckoutViewCopy; step: string; onBack: () => void }): JSX.Element {
  const { Button } = useCheckoutComponents();
  return (
    <Box sx={{ minHeight: 36, display: "flex", alignItems: "center", gap: 1 }}>
      <Button variant="text" color="neutral" size="sm" icon={<ArrowBackIcon fontSize="small" />} iconPosition="left" onClick={onBack} dataTestId="checkout-back">
        {step === "dados" ? copy.dados.keepShopping : copy.dados.back}
      </Button>
    </Box>
  );
}

/**
 * The phone's header (FUT-3525, layout C): "← Voltar" with "Etapa 2 de 3 ·
 * Pagamento" on the same row, and a thin bar filled to the step — the dots
 * of the computer's stepper cost a phone a row for the same fact.
 */
function CompactHeader({
  copy,
  step,
  onBack,
}: {
  copy: CheckoutViewCopy;
  step: string;
  onBack: () => void;
}): JSX.Element {
  const { Button, Text } = useCheckoutComponents();
  const layout = useCheckoutCopy().screens.layout;
  const steps = stepperSteps(copy);
  const at = Math.max(
    0,
    steps.findIndex((item) => item.id === step),
  );
  const current = steps[at];
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <Box
        sx={{
          minHeight: 44,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1,
        }}
      >
        {/* Its label on the column's edge, as the prototype draws it: the text
            button's own padding would push it 12px in. */}
        <Box sx={{ ml: -1.5 }}>        <Button
            variant="text"
            color="neutral"
            size="sm"
            icon={<ArrowBackIcon fontSize="small" />}
            iconPosition="left"
            onClick={onBack}
            dataTestId="checkout-back"
          >
            {step === "dados" ? copy.dados.keepShopping : copy.dados.back}
          </Button>
        </Box>
        <Text
          variant="body"
          size="xs"
          as="span"
          data-testid="checkout-step-progress"
        >
          {layout.stepProgress(at + 1, steps.length, current?.label ?? "")}
        </Text>
      </Box>
      <Box
        // The bar draws the sentence beside it; a reader hears that once.
        aria-hidden
        data-testid="checkout-stepper"
        sx={{
          height: 4,
          borderRadius: 2,
          bgcolor: "divider",
          overflow: "hidden",
        }}
      >
        <Box
          sx={{
            height: "100%",
            width: `${((at + 1) / steps.length) * 100}%`,
            bgcolor: "primary.main",
            borderRadius: 2,
          }}
        />
      </Box>
    </Box>
  );
}

/** Compact 50px progress header so the form stays above the fold on mobile. */
function ProgressHeader({ copy, step, completed }: { copy: CheckoutViewCopy; step: string; completed: Set<string> }): JSX.Element {
  const { Stepper } = useCheckoutComponents();
  return (
    <Box sx={{ height: 50, display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <Stepper steps={stepperSteps(copy)} activeId={step} completed={completed} orientation="horizontal" size="sm" data-testid="checkout-stepper" />
    </Box>
  );
}

/** The header for the frame the flow is in: back link and stepper on a computer, one compact row on a phone. */
export function FlowHeader({
  copy,
  step,
  completed,
  onBack,
}: {
  copy: CheckoutViewCopy;
  step: string;
  completed: Set<string>;
  onBack: () => void;
}): JSX.Element {
  const wide = useCheckoutLayout()?.wide ?? false;
  if (!wide) return <CompactHeader copy={copy} step={step} onBack={onBack} />;
  return (
    <>
      <CheckoutHeader copy={copy} step={step} onBack={onBack} />
      <ProgressHeader copy={copy} step={step} completed={completed} />
    </>
  );
}

/**
 * Measured at the HOST's full width: one frame for the whole flow. Pagamento
 * alone takes that width (its summary column); every other step keeps the
 * 672px column it always had.
 */
export function CheckoutFrame({ payment, children }: { payment: boolean; children: ReactNode }): JSX.Element {
  const [wide, frame] = useWideLayout();
  const layout = useMemo(() => ({ wide }), [wide]);
  return (
    <Box ref={frame} sx={{ width: "100%" }}>
      <CheckoutLayoutProvider value={layout}>
        <Box sx={{ display: "flex", flexDirection: "column", gap: { xs: 2, sm: 3 }, width: "100%", mx: "auto", maxWidth: payment ? "none" : STEP_COLUMN_MAX }}>
          {children}
        </Box>
      </CheckoutLayoutProvider>
    </Box>
  );
}
