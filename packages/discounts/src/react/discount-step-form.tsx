"use client";

import { useEffect, useRef, useState, type Dispatch, type JSX, type RefObject, type SetStateAction } from "react";

import { StepCardList, type StepCardItem } from "@12-apps/ui/data-display/StepCardList";
import { useFormContext } from "@12-apps/ui/form/total-form";
import { Box } from "@12-apps/ui/mui/Box";
import { followBlock, revealBlock, type RevealOptions } from "@12-apps/ui/utils";

import type { WireTargetGroup } from "./api";
import { asideMinPx, ComboPreviewLayout } from "./combo-cart-preview";
import { paintOf, stickyTopSx, useHeight, useInsets, useScrollArea } from "./scroll-area";
import { fill, type CompleteDiscountsWebCopy } from "./copy";
import type { CurrencyFieldComponent } from "./discount-form-fields";
import { validate } from "./discount-form-validate";
import type { DiscountFormValues } from "./discount-form-values";
import { isDirty } from "./form-dirty";
import { FormChrome } from "./form-chrome";
import type { DiscountsFormatters } from "./format";
import { useElementWidth } from "./kind-field";
import {
  revealWatchOf,
  shownErrors,
  useDropAnsweredServerErrors,
  useRevealOnAppear,
  useShownErrors,
  type ServerErrors,
} from "./step-effects";
import { ResumoCard, StepFace, StepNav, SubmitBar, type FaceWorld, type StepExtras } from "./step-faces";
import { countsStep, flowKindChanged, flowNext, flowOpen, flowOpenTried, flowToggleAll, stepStateOf, submitHold, type StepFlow } from "./step-flow";
import { errorsOfStep, missingLine, pendencias, stepOfKey, STEPS, type Pendencia, type StepNumber } from "./step-keys";
import { doneLines, resumoSentence, ruleChips, stripChips, type FormSnapshot, type StripChip, type SummaryWorld } from "./step-summary";
import { FALLBACK_CARD_PX, rowMinPx } from "./tipo-cards";

/**
 * "Novo desconto" / "Editar desconto" as four collapsing steps (FUT-4477) with
 * the product editor's chrome (FUT-4478): the body of `DiscountForm`, inside
 * its `FormContainer`. The steps are a VIEW over the same values, the same
 * `validate()` and the same submit: the payload a given input produces is
 * byte-for-byte what the single page sent.
 */

export interface StepFormProps {
  copy: CompleteDiscountsWebCopy;
  formatters: DiscountsFormatters;
  currencyField: CurrencyFieldComponent;
  groups: readonly WireTargetGroup[];
  editing: boolean;
  extra: StepExtras;
  window: FaceWorld["window"];
  datesLocked: boolean;
  flow: StepFlow;
  setFlow: Dispatch<SetStateAction<StepFlow>>;
  server: ServerErrors;
  setServer: Dispatch<SetStateAction<ServerErrors>>;
  error: string | null;
  onDirtyChange: (dirty: boolean) => void;
}

/** The side column's distance under the sticky chrome: the body's own top gap. */
const ASIDE_GAP_PX = 8;

const STEP_IDS: Readonly<Record<StepNumber, string>> = { 1: "identity", 2: "targets", 3: "price", 4: "rules" };

/** Where a strip chip scrolls to: its own block, when it is on screen (contract C4). */
const CHIP_TARGET: Readonly<Record<StripChip["id"], string>> = {
  active: '[data-reveal="switches"]',
  activation: '[data-testid="total-form-field-code"], [data-reveal="activation"]',
  period: '[data-testid="schedule-builder"], [data-reveal="window"]',
  stacking: '[data-reveal="switches"]',
  limits: '[data-reveal="limits"]',
  firstOrder: '[data-reveal="firstOrder"]',
};

function stepTitle(step: StepNumber, kind: string, copy: CompleteDiscountsWebCopy): string {
  const { steps } = copy;
  if (step === 1) return steps.identity;
  if (step === 2) return kind === "COMBO" ? steps.comboTargets : kind === "FREE_UNITS" ? steps.freeTargets : steps.plainTargets;
  if (step === 3) return kind === "FREE_UNITS" ? steps.freeTimes : steps.price;
  return steps.rules;
}

function snapshotOf(values: Readonly<Record<string, string>>, extra: StepExtras): FormSnapshot {
  return {
    values,
    categoryIds: extra.categoryIds,
    menuItemIds: extra.menuItemIds,
    slots: extra.comboRequirements,
    active: extra.active,
    stackable: extra.stackable,
    firstOrderOnly: extra.firstOrderOnly,
    scheduleEnabled: extra.scheduleEnabled,
    schedule: extra.schedule,
  };
}

/**
 * After a pendência or a server error opens a step: the caret goes to its first
 * invalid field, and the field is revealed between the sticky bars as they
 * stand THEN — a server refusal's alert grows the foot after the step opened,
 * so the insets are read once it has rendered, never before.
 */
function useFocusField(root: RefObject<HTMLElement | null>, insets: RevealOptions): (step: StepNumber) => void {
  const [request, setRequest] = useState<{ step: StepNumber; at: number } | null>(null);
  useEffect(() => {
    if (request === null) return undefined;
    let frame = 0;
    const timer = window.setTimeout(() => {
      frame = window.requestAnimationFrame(() => {
        const scope = root.current?.querySelector(`[data-testid="discount-steps-${STEP_IDS[request.step]}"]`);
        const field = scope?.querySelector<HTMLElement>('[aria-invalid="true"]');
        if (!field) return;
        field.focus({ preventScroll: true });
        revealBlock(field, insets);
        // Its message too, which sits under it: the reason is the point.
        const owner = field.closest<HTMLElement>('[data-testid^="total-form-field-"]')?.dataset.testid;
        const message = owner ? scope?.querySelector<HTMLElement>(`[data-testid="${owner}-message"]`) : null;
        if (message) revealBlock(message, insets);
      });
    }, 60);
    return () => {
      window.clearTimeout(timer);
      window.cancelAnimationFrame(frame);
    };
    // Once per request; `insets` reads live bars.
  }, [request, root]);
  return (step) => setRequest({ step, at: Date.now() });
}

/**
 * Passing step 4 collapses every card: the submit bar is what comes next, so it
 * is revealed, and — the Pronto that had the caret being gone — the submit takes
 * the caret, never the dialog's root.
 */
function useRevealBarOnCollapse(
  flow: StepFlow,
  root: RefObject<HTMLElement | null>,
  bar: RefObject<HTMLDivElement | null>,
  insets: RevealOptions,
): void {
  const collapsed = flow.cur === 0 && !flow.all;
  const wasCollapsed = useRef(collapsed);
  useEffect(() => {
    if (collapsed && !wasCollapsed.current) {
      revealBlock(bar.current, insets);
      const caret = document.activeElement;
      const lost = caret === null || caret === document.body || !root.current?.contains(caret);
      if (lost) bar.current?.querySelector<HTMLElement>('[data-testid="discount-form-submit"]')?.focus({ preventScroll: true });
    }
    wasCollapsed.current = collapsed;
  });
}

/** A strip chip opens step 4 at its own field (contract C4); the step when the field is absent. */
function useChipReveal(root: RefObject<HTMLElement | null>, insets: RevealOptions): (chip: StripChip) => void {
  const [target, setTarget] = useState<{ selector: string; at: number } | null>(null);
  useEffect(() => {
    if (target === null) return undefined;
    const step = root.current?.querySelector<HTMLElement>(`[data-testid="discount-steps-${STEP_IDS[4]}"]`) ?? null;
    return followBlock(step?.querySelector<HTMLElement>(target.selector) ?? step, insets);
    // Once per chip pressed; `insets` reads live bars.
  }, [target]);
  return (chip) => setTarget({ selector: CHIP_TARGET[chip.id], at: Date.now() });
}

/** A server refusal naming fields puts the caret in the first, on the lowest step it opened. */
function useFocusOnServerRefusal(server: ServerErrors, focusField: (step: StepNumber) => void): void {
  const { round, errors } = server;
  useEffect(() => {
    if (round === 0) return;
    const steps = Object.keys(errors).flatMap((key) => {
      const step = stepOfKey(key);
      return step === null ? [] : [step];
    });
    const first = STEPS.find((step) => steps.includes(step));
    if (first !== undefined) focusField(first);
    // Once per refusal.
  }, [round]);
}

interface ItemInputs {
  copy: CompleteDiscountsWebCopy;
  flow: StepFlow;
  setFlow: Dispatch<SetStateAction<StepFlow>>;
  merged: Readonly<Record<string, string>>;
  form: FormSnapshot;
  world: SummaryWorld;
  faceWorld: FaceWorld;
}

/** The done card's two lines, and its "Falta" in place of the muted line when it is now wrong. */
function doneParts(step: StepNumber, state: StepCardItem["state"], missing: string, inputs: ItemInputs): Partial<StepCardItem> {
  if (state !== "done" && state !== "error") return {};
  const lines = doneLines(step, inputs.form, inputs.world);
  if (state === "error") return { answer: lines.answer, error: missing };
  return lines.detail === "" ? { answer: lines.answer } : { answer: lines.answer, detail: lines.detail };
}

/** One step card. */
function itemOf(step: StepNumber, inputs: ItemInputs): StepCardItem {
  const { copy, flow, setFlow } = inputs;
  const errors = errorsOfStep(inputs.merged, step);
  const missing = missingLine(errors, copy);
  const state = stepStateOf(flow, step, errors.length > 0);
  const title = stepTitle(step, inputs.form.values.kind ?? "PERCENTAGE", copy);
  return {
    id: STEP_IDS[step],
    title,
    state,
    caption: fill(copy.steps.caption, { number: step, name: title }),
    ...doneParts(step, state, missing, inputs),
    invalid: state === "current" && flow.tried.includes(step) && errors.length > 0,
    onChange: () => setFlow((current) => flowOpen(current, step)),
    changeLabel: copy.steps.change,
    changeAriaLabel: fill(copy.steps.changeLabel, { name: title }),
    children: (
      <>
        <StepFace step={step} world={inputs.faceWorld} />
        {!flow.all && (
          <StepNav
            step={step}
            label={step === 4 ? copy.steps.finish : copy.steps.next}
            missing={missing}
            onNext={() => setFlow((current) => flowNext(current, step))}
          />
        )}
      </>
    ),
  };
}

/** Everything the body works out from the form as it is now. */
function useStepModel(props: StepFormProps) {
  const { copy, formatters, groups, editing, extra, flow, server, setServer } = props;
  const { values } = useFormContext();
  const form = snapshotOf(values, extra);
  const baseline = useRef(form);
  const dirty = isDirty(baseline.current, form);
  const { onDirtyChange } = props;
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  const client = validate(values as DiscountFormValues, extra, formatters, copy, {
    enabled: extra.scheduleEnabled,
    schedule: extra.schedule,
    wholeDays: props.window.wholeDays,
    datesLocked: props.datesLocked,
  });
  useShownErrors(shownErrors(client, flow, server));
  useDropAnsweredServerErrors(server, form, setServer);
  const merged = { ...client, ...server.errors };
  const issues = pendencias(merged, (step) => countsStep(flow, editing, step), extra.comboRequirements, copy);
  const hold = submitHold({ flow, editing, issues: issues.length, dirty }, copy);
  const world: SummaryWorld = { copy, formatters, groups };
  return { form, dirty, merged, issues, hold, world };
}

/** A pendência opens its step at the field; a strip chip opens Regras at its own block. */
function chromeActions(
  setFlow: Dispatch<SetStateAction<StepFlow>>,
  focusField: (step: StepNumber) => void,
  revealChip: (chip: StripChip) => void,
): { onIssue: (issue: Pendencia) => void; onChip: (chip: StripChip) => void } {
  return {
    onIssue: (issue) => {
      setFlow((current) => flowOpenTried(current, [issue.step]));
      focusField(issue.step);
    },
    onChip: (chip) => {
      setFlow((current) => flowOpen({ ...current, all: false }, 4));
      revealChip(chip);
    },
  };
}

export function DiscountStepForm(props: StepFormProps): JSX.Element {
  const { copy, formatters, groups, editing, extra, flow, setFlow } = props;
  const root = useRef<HTMLDivElement>(null);
  const width = useElementWidth(root);
  const area = useScrollArea(root);
  const [rowMin, setRowMin] = useState(rowMinPx(FALLBACK_CARD_PX));
  const { chrome, bar, insets } = useInsets();
  const chromeHeight = useHeight(chrome);
  const focusField = useFocusField(root, insets);
  const { form, dirty, merged, issues, hold, world } = useStepModel(props);
  useRevealOnAppear(root, revealWatchOf(form), insets);
  useRevealBarOnCollapse(flow, root, bar, insets);
  useFocusOnServerRefusal(props.server, focusField);
  const revealChip = useChipReveal(root, insets);
  const wide = width !== null && width >= asideMinPx(rowMin);
  const { currencyField, window: windowFlags } = props;
  const onKindChange = (): void => setFlow(flowKindChanged);
  const faceWorld: FaceWorld = { copy, currencyField, groups, extra, window: windowFlags, onKindChange, onRowMin: setRowMin };
  const items = STEPS.map((step) => itemOf(step, { copy, flow, setFlow, merged, form, world, faceWorld }));
  const sentence = resumoSentence(form, world);

  return (
    <Box
      ref={root}
      data-testid="discount-step-form"
      sx={{ minWidth: 0, display: "flex", flexDirection: "column", minHeight: area.height === null ? undefined : `${area.height}px` }}
    >
      <Box ref={chrome} sx={stickyTopSx(area)}>
        <FormChrome
          copy={copy}
          editing={editing}
          dirty={dirty}
          issues={issues}
          strip={editing ? stripChips(form, world) : []}
          seeAll={editing ? null : { all: flow.all, onToggle: () => setFlow(flowToggleAll) }}
          {...chromeActions(setFlow, focusField, revealChip)}
        />
      </Box>
      <Box sx={{ flex: 1, pt: 1 }}>
        <ComboPreviewLayout
          copy={copy}
          formatters={formatters}
          groups={groups}
          slots={extra.comboRequirements}
          wide={wide}
          // Below the chrome as it stands now: it grows with its pendências panel.
          stickyTop={chromeHeight + ASIDE_GAP_PX - area.ownTop}
          aside={<ResumoCard copy={copy} sentence={sentence} chips={ruleChips(form, world)} />}
        >
          <StepCardList
            aria-label={copy.steps.list}
            dataTestId="discount-steps"
            items={items}
            allOpen={flow.all}
            reveal={insets}
            revealWatch={[chrome.current, bar.current]}
          />
        </ComboPreviewLayout>
      </Box>
      <SubmitBar
        bar={bar}
        reach={area.padBottom}
        edge={area.ownBottom}
        paint={paintOf(area)}
        copy={copy}
        error={props.error}
        narrowSentence={wide ? null : sentence}
        hold={hold}
        label={editing ? copy.form.submitEdit : copy.form.submitCreate}
      />
    </Box>
  );
}
