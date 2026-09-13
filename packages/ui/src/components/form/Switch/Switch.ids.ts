import type { InputHTMLAttributes, ReactNode } from 'react';

/** The ids the DOM `Switch` wires its label and its two descriptions with. */
export interface SwitchIds {
  /** The input's id. Always set — the label has to have something to point at. */
  inputId: string;
  descriptionId?: string;
  helperId?: string;
  /** Everything that DESCRIBES the control, the caller's own included. */
  describedBy?: string;
}

export interface SwitchIdSource {
  /** `useId()`'s value, passed in so this stays a pure function. */
  generated: string;
  id?: string;
  inputProps?: InputHTMLAttributes<HTMLInputElement>;
  description?: ReactNode;
  helperText?: ReactNode;
  callerDescribedBy?: unknown;
}

/**
 * Derive every id one `Switch` needs, in one place (FUT-1905).
 *
 * The precedence is the point: an id the caller spelled — as `inputProps.id` or
 * as `id` — wins, because a consumer that chose one is usually pointing its own
 * `<label>` or a test at it. Only when there is none does the generated one
 * apply, and it comes from `useId` rather than from the test id: two call sites
 * sharing a `dataTestId` would otherwise share a `for`, and the second label
 * would toggle the first control.
 *
 * `describedBy` APPENDS rather than replaces. The description and the helper
 * line are the component's own, but a consumer that passed `aria-describedby`
 * meant it, and dropping it to make room would trade one silent omission for
 * another.
 */
export function switchIds({
  generated,
  id,
  inputProps,
  description,
  helperText,
  callerDescribedBy,
}: SwitchIdSource): SwitchIds {
  const inputId = inputProps?.id ?? id ?? `switch-${generated}`;
  const descriptionId = description ? `${inputId}-description` : undefined;
  const helperId = helperText ? `${inputId}-helper` : undefined;

  return {
    inputId,
    descriptionId,
    helperId,
    describedBy:
      [callerDescribedBy, descriptionId, helperId].filter(Boolean).join(' ') || undefined,
  };
}
