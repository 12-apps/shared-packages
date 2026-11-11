import { fireEvent, screen } from "@testing-library/react";

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

/** The element with this test id, opening the step that holds it first. */
export function reach(testId: string): HTMLElement {
  const found = screen.queryAllByTestId(testId)[0];
  if (found) return found;
  showEveryStep();
  for (const id of STEP_IDS) {
    const there = screen.queryAllByTestId(testId)[0];
    if (there) return there;
    const change = screen.queryByTestId(`discount-steps-${id}-change`);
    if (change) fireEvent.click(change);
  }
  return screen.getByTestId(testId);
}

/** The submit, as the single page sent it: the form's own submit event, whatever the button's hold. */
export function submitForm(): void {
  fireEvent.submit(screen.getByTestId("discount-form").closest("form") ?? screen.getByTestId("discount-form"));
}
