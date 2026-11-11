"use client";

import { useEffect, useRef, useState, type Dispatch, type JSX, type RefObject, type SetStateAction } from "react";

import { StepCardList, type StepCardItem } from "@12-apps/ui/data-display/StepCardList";
import { Button } from "@12-apps/ui/form/Button";
import { useFormContext } from "@12-apps/ui/form/total-form";
import { Box } from "@12-apps/ui/mui/Box";
import { followBlock, revealBlock, type RevealOptions } from "@12-apps/ui/utils";

import type { WireTargetGroup } from "./api";
import { asideMinPx, ComboPreviewLayout } from "./combo-cart-preview";
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

/** Bars that stay in view publish their heights: the reveal moves only past them. */
function useInsets(): { chrome: RefObject<HTMLDivElement | null>; bar: RefObject<HTMLDivElement | null>; insets: RevealOptions } {
  const chrome = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  return {
    chrome,
    bar,
    insets: { topInset: () => chrome.current?.offsetHeight ?? 0, bottomInset: () => bar.current?.offsetHeight ?? 0 },
  };
}

/** After a pendência or a server error opens a step: the caret goes to its first invalid field. */
function useFocusField(root: RefObject<HTMLElement | null>): (step: StepNumber) => void {
  const [request, setRequest] = useState<{ step: StepNumber; at: number } | null>(null);
  useEffect(() => {
    if (request === null) return undefined;
    const timer = window.setTimeout(() => {
      const scope = root.current?.querySelector(`[data-testid="discount-steps-${STEP_IDS[request.step]}"]`);
      scope?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    }, 60);
    return () => window.clearTimeout(timer);
  }, [request, root]);
  return (step) => setRequest({ step, at: Date.now() });
}

/** Passing step 4 collapses every card: the submit bar is what comes next. */
function useRevealBarOnCollapse(flow: StepFlow, bar: RefObject<HTMLDivElement | null>, insets: RevealOptions): void {
  const collapsed = flow.cur === 0 && !flow.all;
  const wasCollapsed = useRef(collapsed);
  useEffect(() => {
    if (collapsed && !wasCollapsed.current) revealBlock(bar.current, insets);
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

export function DiscountStepForm(props: StepFormProps): JSX.Element {
  const { copy, formatters, groups, editing, extra, flow, setFlow } = props;
  const root = useRef<HTMLDivElement>(null);
  const width = useElementWidth(root);
  const [rowMin, setRowMin] = useState(rowMinPx(FALLBACK_CARD_PX));
  const { chrome, bar, insets } = useInsets();
  const focusField = useFocusField(root);
  const { form, dirty, merged, issues, hold, world } = useStepModel(props);
  useRevealOnAppear(root, revealWatchOf(form), insets);
  useRevealBarOnCollapse(flow, bar, insets);
  useFocusOnServerRefusal(props.server, focusField);
  const revealChip = useChipReveal(root, insets);
  const wide = width !== null && width >= asideMinPx(rowMin);
  const faceWorld: FaceWorld = {
    copy,
    currencyField: props.currencyField,
    groups,
    extra,
    window: props.window,
    onKindChange: () => setFlow(flowKindChanged),
    onRowMin: setRowMin,
  };
  const items = STEPS.map((step) => itemOf(step, { copy, flow, setFlow, merged, form, world, faceWorld }));
  const sentence = resumoSentence(form, world);

  return (
    <Box ref={root} data-testid="discount-step-form" sx={{ minWidth: 0 }}>
      <Box ref={chrome} sx={{ position: "sticky", top: 0, zIndex: 1, bgcolor: "background.paper", pb: 1.5 }}>
        <FormChrome
          copy={copy}
          editing={editing}
          dirty={dirty}
          issues={issues}
          strip={editing ? stripChips(form, world) : []}
          onIssue={(issue: Pendencia) => {
            setFlow((current) => flowOpenTried(current, [issue.step]));
            focusField(issue.step);
          }}
          onChip={(chip: StripChip) => {
            setFlow((current) => flowOpen({ ...current, all: false }, 4));
            revealChip(chip);
          }}
        />
      </Box>
      <ComboPreviewLayout
        copy={copy}
        formatters={formatters}
        groups={groups}
        slots={extra.comboRequirements}
        wide={wide}
        stickyTop={chrome.current?.offsetHeight ?? 0}
        aside={<ResumoCard copy={copy} sentence={sentence} chips={ruleChips(form, world)} />}
      >
        {!editing && (
          <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 1 }}>
            <Button variant="text" type="button" onClick={() => setFlow(flowToggleAll)} dataTestId="discount-see-all">
              {flow.all ? copy.steps.backToSteps : copy.steps.seeAll}
            </Button>
          </Box>
        )}
        <StepCardList
          aria-label={copy.steps.list}
          dataTestId="discount-steps"
          items={items}
          allOpen={flow.all}
          reveal={insets}
          revealWatch={[chrome.current, bar.current]}
        />
      </ComboPreviewLayout>
      <SubmitBar
        bar={bar}
        copy={copy}
        error={props.error}
        narrowSentence={wide ? null : sentence}
        hold={hold}
        label={editing ? copy.form.submitEdit : copy.form.submitCreate}
      />
    </Box>
  );
}
