"use client";

import { useId, type JSX, type ReactNode, type RefObject } from "react";

import { Alert } from "@12-apps/ui/data-display/Alert";
import { Chip } from "@12-apps/ui/data-display/Chip";
import { Button } from "@12-apps/ui/form/Button";
import { FormMessage } from "@12-apps/ui/form/Form";
import { Fields, SubmitButton, useFormContext } from "@12-apps/ui/form/total-form";
import { Box } from "@12-apps/ui/mui/Box";
import { Stack } from "@12-apps/ui/mui/Stack";
import { Text } from "@12-apps/ui/typography/Text";

import type { DiscountSchedule } from "../engine/schedule";
import type { ComboRequirement } from "../engine/types";

import type { WireTargetGroup } from "./api";
import type { CompleteDiscountsWebCopy } from "./copy";
import type { DiscountsTimeZoneSettings } from "./days-unknown-notice";
import {
  ComboCapField,
  DiscountSwitches,
  LimitFields,
  RewardFields,
  ScopeField,
  TriggerFields,
  WindowFields,
  type CurrencyFieldComponent,
} from "./discount-form-fields";
import type { DatesLock } from "./discount-form-values";
import { DiscountTargetPicker } from "./discount-target-picker";
import { FirstOrderField } from "./first-order-field";
import { isComboKind, type DiscountKind } from "./form-kind";
import { TipoCards } from "./tipo-cards";

/**
 * What each open step card holds (FUT-4475, "The screen"): today's field
 * components, mounted unchanged, in the order the approved prototype draws
 * them. `data-reveal` marks the blocks a status-strip chip scrolls to.
 */

/** The state `total-form` cannot hold, owned by the form and passed down. */
export interface StepExtras {
  active: boolean;
  stackable: boolean;
  firstOrderOnly: boolean;
  categoryIds: string[];
  menuItemIds: string[];
  comboRequirements: ComboRequirement[];
  scheduleEnabled: boolean;
  schedule: DiscountSchedule;
  setActive: (next: boolean) => void;
  setStackable: (next: boolean) => void;
  setFirstOrderOnly: (next: boolean) => void;
  setCategoryIds: (next: string[]) => void;
  setMenuItemIds: (next: string[]) => void;
  setComboRequirements: (next: ComboRequirement[]) => void;
  setScheduleEnabled: (next: boolean) => void;
  setSchedule: (next: DiscountSchedule) => void;
}

export interface FaceWorld {
  copy: CompleteDiscountsWebCopy;
  currencyField: CurrencyFieldComponent;
  groups: readonly WireTargetGroup[];
  extra: StepExtras;
  window: {
    wholeDays: boolean;
    datesLock: DatesLock;
    timezoneLabel: string | null;
    timeZoneSettings: DiscountsTimeZoneSettings | undefined;
  };
  onKindChange: (kind: DiscountKind) => void;
  onRowMin: (px: number) => void;
}

function IdentityFace({ world }: { world: FaceWorld }): JSX.Element {
  return (
    <Stack spacing={2}>
      <Fields.TextField name="name" label={world.copy.form.name} />
      <TipoCards copy={world.copy} onKindChange={world.onKindChange} onRowMin={world.onRowMin} />
    </Stack>
  );
}

/**
 * Step 2. A combo's `errors.kind` sits at the foot, under the builder, as the
 * prototype draws it — except the two the builders already say: the empty
 * group under its row, and Itens grátis' missing product under its picker
 * (the same sentence is said once).
 */
function TargetsFace({ world }: { world: FaceWorld }): JSX.Element {
  const { values, errors } = useFormContext();
  const { copy, extra } = world;
  const kind = values.kind ?? "PERCENTAGE";
  const footer = errors.kind;
  const saidElsewhere = footer === copy.form.comboSlotTargetRequired || footer === copy.form.freeUnitsTargetRequired;
  return (
    <Stack spacing={2}>
      <ScopeField copy={copy} />
      <DiscountTargetPicker
        groups={world.groups}
        copy={copy}
        inStep
        selection={{
          categoryIds: extra.categoryIds,
          menuItemIds: extra.menuItemIds,
          comboRequirements: extra.comboRequirements,
          onCategoryIdsChange: extra.setCategoryIds,
          onMenuItemIdsChange: extra.setMenuItemIds,
          onComboRequirementsChange: extra.setComboRequirements,
        }}
      />
      {!isComboKind(kind) && (values.scope ?? "ORDER") === "ORDER" && <Text variant="caption">{copy.steps.wholeOrderNote}</Text>}
      {isComboKind(kind) && footer !== undefined && !saidElsewhere && (
        <FormMessage error dataTestId="discount-step-targets-message">
          {footer}
        </FormMessage>
      )}
    </Stack>
  );
}

function PriceFace({ world }: { world: FaceWorld }): JSX.Element {
  return (
    <Stack spacing={2}>
      <RewardFields copy={world.copy} currencyField={world.currencyField} />
      <ComboCapField copy={world.copy} />
    </Stack>
  );
}

function RulesFace({ world }: { world: FaceWorld }): JSX.Element {
  const { copy, extra } = world;
  return (
    <Stack spacing={2}>
      <Text variant="caption">{copy.steps.rulesIntro}</Text>
      <Box data-reveal="activation">
        <TriggerFields copy={copy} />
      </Box>
      <Box data-reveal="window">
        <WindowFields
          copy={copy}
          {...world.window}
          schedule={extra.schedule}
          scheduleEnabled={extra.scheduleEnabled}
          onScheduleChange={extra.setSchedule}
          onScheduleEnabledChange={extra.setScheduleEnabled}
        />
      </Box>
      <Stack spacing={1.5} data-reveal="limits">
        <Text variant="heading">{copy.steps.limitsTitle}</Text>
        <LimitFields copy={copy} currencyField={world.currencyField} />
      </Stack>
      <Box data-reveal="firstOrder">
        <FirstOrderField copy={copy} checked={extra.firstOrderOnly} onChange={extra.setFirstOrderOnly} />
      </Box>
      <Box data-reveal="switches">
        <DiscountSwitches
          copy={copy}
          active={extra.active}
          stackable={extra.stackable}
          onActive={extra.setActive}
          onStackable={extra.setStackable}
        />
      </Box>
    </Stack>
  );
}

/** The face of step n. */
export function StepFace({ step, world }: { step: 1 | 2 | 3 | 4; world: FaceWorld }): JSX.Element {
  if (step === 1) return <IdentityFace world={world} />;
  if (step === 2) return <TargetsFace world={world} />;
  if (step === 3) return <PriceFace world={world} />;
  return <RulesFace world={world} />;
}

/** Continuar / Pronto, disabled while the step has errors, "Falta: …" beside it. */
export function StepNav({
  step,
  label,
  missing,
  onNext,
}: {
  step: number;
  label: string;
  missing: string;
  onNext: () => void;
}): JSX.Element {
  const why = useId();
  // The mock's 16 px from the last field: its own 14 px bottom margin plus 2.
  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1.25, mt: 0.25 }}>
      <Box sx={{ flexShrink: 0, "& > button": { whiteSpace: "nowrap" } }}>
        <Button
          variant="solid"
          type="button"
          disabled={missing !== ""}
          aria-describedby={why}
          onClick={onNext}
          dataTestId={`discount-step-${step}-next`}
        >
          {label}
        </Button>
      </Box>
      <Text as="span" variant="caption" id={why} data-testid={`discount-step-${step}-missing`}>
        {missing}
      </Text>
    </Box>
  );
}

/** The "Resumo" card of the side column: the sentence and the rule chips. */
export function ResumoCard({ copy, sentence, chips }: { copy: CompleteDiscountsWebCopy; sentence: string; chips: readonly string[] }): JSX.Element {
  return (
    <Box data-testid="discount-resumo" sx={{ border: 1, borderColor: "divider", borderRadius: 1.5, p: 2.25, bgcolor: "background.paper" }}>
      <Stack spacing={1.25}>
        <Text as="p" variant="caption" weight="semibold" style={{ textTransform: "uppercase" }}>
          {copy.steps.resumo}
        </Text>
        {sentence !== "" && (
          <Text as="p" weight="medium" data-testid="discount-resumo-sentence">
            {sentence}
          </Text>
        )}
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }} data-testid="discount-resumo-chips">
          {chips.map((chip, index) => (
            <Chip key={`${chip}-${index}`} size="sm" variant="soft" color="neutral" label={chip} />
          ))}
        </Box>
      </Stack>
    </Box>
  );
}

/**
 * The bar at the foot of the form, sticky at the bottom of the scroll area and
 * inside the `<form>`: the save-failed alert, the narrow form's sentence, the
 * reason the submit is held, and the submit.
 */
export function SubmitBar({
  bar,
  reach,
  edge,
  paint,
  copy,
  error,
  narrowSentence,
  hold,
  label,
}: {
  bar: RefObject<HTMLDivElement | null>;
  /** The space between the form and the area's bottom edge, which the bar reaches across (measured). */
  reach: number;
  /** The area's own bottom padding: sticky offsets count from inside it (measured). */
  edge: number;
  /** The dialog surface's own paint, so the bar is that surface (measured). */
  paint: Record<string, string>;
  copy: CompleteDiscountsWebCopy;
  error: string | null;
  narrowSentence: string | null;
  hold: string | null;
  label: ReactNode;
}): JSX.Element {
  const narrow = narrowSentence !== null;
  const holdId = useId();
  return (
    <Box
      ref={bar}
      data-testid="discount-submit-bar"
      sx={{
        // Pulled down across the space under the form to the area's bottom
        // edge, and sticky at that edge: it rests where it sticks, never moves.
        position: "sticky",
        bottom: -edge,
        mb: `${-reach}px`,
        zIndex: 1,
        ...paint,
        borderTop: 1,
        borderColor: "divider",
        pt: 1.5,
        pb: 2,
        mt: 2,
      }}
    >
      {error && (
        <Box sx={{ mb: 1 }}>
          <Alert variant="danger" title={copy.form.saveFailed} description={error} data-testid="discount-form-error" />
        </Box>
      )}
      <Box
        sx={{
          display: "flex",
          gap: narrow ? 0.75 : 1.5,
          flexDirection: narrow ? "column" : "row",
          alignItems: narrow ? "stretch" : "center",
          justifyContent: "flex-end",
          "& > div > button": narrow ? { width: "100%" } : {},
        }}
      >
        {narrow && narrowSentence !== "" && <Text variant="caption" data-testid="discount-submit-sentence">{narrowSentence}</Text>}
        <Text as="span" variant="caption" id={holdId} data-testid="discount-submit-hold">
          {hold ?? ""}
        </Text>
        <Box>
          <SubmitButton dataTestId="discount-form-submit" disabled={hold !== null} {...(hold !== null ? { describedBy: holdId } : {})}>
            {label}
          </SubmitButton>
        </Box>
      </Box>
    </Box>
  );
}
