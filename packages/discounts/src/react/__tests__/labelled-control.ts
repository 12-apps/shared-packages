import { screen } from "@testing-library/react";

import { opening } from "./step-form-shim";

/**
 * The control a `<label for>` names — what `getByLabelText` answers on these
 * forms, at a fraction of its cost (FUT-4530).
 *
 * `getByLabelText` asks EVERY button and input in the document for its
 * `labels`, and jsdom answers each by walking the whole tree once per label
 * there. The discounts screen has 93 buttons (the calendar's days among them),
 * 16 labels and 1,348 nodes, so one query took 600 ms there and 120 ms on the
 * bare form, before a loaded CI runner multiplied it by four: that is what
 * pushed the round-five cases past vitest's 5 s. This finds the one label by
 * its own text and resolves `for` by id, so it still fails when the words are
 * not a label, when two labels say them, or when the label names nothing. A
 * field in a closed step is reached by opening its step first (FUT-4477).
 */
export function getByLabelFor(text: string): HTMLInputElement {
  const label = (opening(() => screen.queryAllByText(text, { selector: "label" })[0] ?? null) ??
    screen.getByText(text, { selector: "label" })) as HTMLLabelElement;
  const control = label.htmlFor === "" ? null : document.getElementById(label.htmlFor);
  if (!(control instanceof HTMLInputElement)) {
    throw new Error(`The label "${text}" names no input (for="${label.htmlFor}").`);
  }
  return control;
}
