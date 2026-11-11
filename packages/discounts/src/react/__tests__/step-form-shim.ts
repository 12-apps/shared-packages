import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect } from "vitest";

import { EN_US_DISCOUNTS_WEB_COPY } from "../en-US";
import { PT_BR_DISCOUNTS_WEB_COPY } from "../pt-BR";

/**
 * The form is four collapsing steps (FUT-4477): a field is on screen only while
 * its step is open. Suites written against the single-page form reach a field
 * through these, which open what holds it the way an operator would — "Ver tudo
 * numa página" on a create, the step's "Alterar" on an edit — and then assert
 * exactly what they asserted before.
 */

const STEP_IDS = ["identity", "targets", "price", "rules"] as const;

/** Every step open at once, when the form offers it (a create). */
export function showEveryStep(): void {
  const seeAll = screen.queryByTestId("discount-see-all");
  if (seeAll && !seeAll.textContent?.includes("passo a passo") && !seeAll.textContent?.includes("step by step")) {
    fireEvent.click(seeAll);
  }
}

type StepId = (typeof STEP_IDS)[number];

/**
 * The step a test id most likely sits in, by its name: the edit form opens one
 * step at a time, and walking all four from the first to reach Regras mounted
 * three steps for nothing — on a loaded runner, most of a 5 s case (PR #1006).
 * Only a first guess: when it is wrong, the walk below still finds the field.
 */
const STEP_HINTS: ReadonlyArray<readonly [RegExp, StepId]> = [
  [/^(total-form-field-name|discount-kind-)/u, "identity"],
  [/^(total-form-field-scope|total-form-field-kind|combo-slot|combo-slots|combo-add-slot|free-units-|discount-(categories|items)-targets)/u, "targets"],
  [/^(total-form-field-(percentOff|amountOff|bundlePrice|comboReward|maxComboApplications)|currency-|combo-(reward|cart-preview|summary|cap))/u, "price"],
  [/^(total-form-field-(code|trigger|startsAt|endsAt|usageLimit|perBuyerLimit|minSubtotal)|discount-(period|active|days-unknown|first-order-only|stackable)|schedule-|repetition-)/u, "rules"],
];

/** Opens the hinted step of `testId`, when the form shows its "Alterar". */
function openHinted(testId: string | undefined): void {
  const hint = testId === undefined ? undefined : STEP_HINTS.find(([pattern]) => pattern.test(testId))?.[1];
  const change = hint === undefined ? null : screen.queryByTestId(`discount-steps-${hint}-change`);
  if (change) fireEvent.click(change);
}

/** What `find` finds, opening the steps one by one until it does; null if no step holds it. */
export function opening(find: () => HTMLElement | null, testId?: string): HTMLElement | null {
  const found = find();
  if (found) return found;
  showEveryStep();
  openHinted(testId);
  for (const id of STEP_IDS) {
    const there = find();
    if (there) return there;
    const change = screen.queryByTestId(`discount-steps-${id}-change`);
    if (change) fireEvent.click(change);
  }
  return find();
}

/** The element with this test id, opening the step that holds it first. */
export function reach(testId: string): HTMLElement {
  return opening(() => screen.queryAllByTestId(testId)[0] ?? null, testId) ?? screen.getByTestId(testId);
}

/** `getByLabelText`, opening the step that holds the field first. */
export function reachLabel(label: string): HTMLElement {
  const hint = [PT_BR_DISCOUNTS_WEB_COPY, EN_US_DISCOUNTS_WEB_COPY]
    .flatMap((pack) => Object.entries(pack.form))
    .find(([, text]) => text === label)?.[0];
  return opening(() => screen.queryAllByLabelText(label)[0] ?? null, hint && `total-form-field-${hint}`) ?? screen.getByLabelText(label);
}

/** The submit, as the single page sent it: the form's own submit event, whatever the button's hold. */
export function submitForm(): void {
  fireEvent.submit(screen.getByTestId("discount-form").closest("form") ?? screen.getByTestId("discount-form"));
}

/**
 * `findByTestId`, but a field in a closed step is reached by opening the step.
 * Nothing is clicked inside a `waitFor` callback: a click there mutates the DOM,
 * which re-runs the callback, and the loop starves the timer that would end it.
 */
export async function findReach(
  testId: string,
  _query?: undefined,
  options?: { timeout?: number },
): Promise<HTMLElement> {
  await waitFor(
    () => expect(screen.queryAllByTestId(testId).length + screen.queryAllByTestId("discount-form").length).toBeGreaterThan(0),
    options,
  );
  const now = opening(() => screen.queryAllByTestId(testId)[0] ?? null, testId);
  if (now) return now;
  return screen.findByTestId(testId, undefined, options);
}

/** `getByTestId` with no step opened: for a `waitFor` callback, which must not click. */
export function peek(testId: string): HTMLElement {
  return screen.getByTestId(testId);
}

/** Let a refused submit settle: the step it opens, and the messages it shows. */
export async function settle(): Promise<void> {
  await waitFor(() => expect(screen.getByTestId("discount-form")).toBeTruthy());
}
