"use client";

import { useEffect, useRef, type RefObject } from "react";

import { useFormContext } from "@12-apps/ui/form/total-form";
import { followBlock, type RevealOptions } from "@12-apps/ui/utils";

import { stampOf } from "./form-dirty";
import type { StepFlow } from "./step-flow";
import { stepOfKey } from "./step-keys";
import type { FormSnapshot } from "./step-summary";

/**
 * The step form's side effects (FUT-4477, FUT-4478): which messages the
 * context's `errors` holds, when a server error is answered, and which block
 * scrolls into view as it appears.
 */

/** The server's field errors, kept apart from the client's: `validate()` cannot know a duplicate code. */
export interface ServerErrors {
  errors: Readonly<Record<string, string>>;
  /** What each error was attached to when it came back (`stampOf`); a change drops it. */
  stamps: Readonly<Record<string, string>>;
  /** The last submit was refused by the server: `FormErrorSnackbar`'s `show`. */
  refused: boolean;
  /** One more per server refusal that named fields: the form then puts the caret in the first. */
  round: number;
}

export const NO_SERVER_ERRORS: ServerErrors = { errors: {}, stamps: {}, refused: false, round: 0 };

/** The server's errors as they came back, stamped against the form they answer. */
export function serverErrorsOf(
  fieldErrors: Readonly<Record<string, string | undefined>>,
  form: FormSnapshot,
  round: number,
): ServerErrors {
  const errors = Object.fromEntries(
    Object.entries(fieldErrors).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== ""),
  );
  const stamps = Object.fromEntries(Object.keys(errors).map((key) => [key, stampOf(key, form)]));
  return { errors, stamps, refused: Object.keys(errors).length > 0, round };
}

/**
 * The messages on screen: every TRIED step's client errors, merged with the
 * server's. One full map per call, because `setFieldErrors` replaces the map.
 */
export function shownErrors(
  client: Readonly<Record<string, string>>,
  flow: StepFlow,
  server: ServerErrors,
): Record<string, string> {
  const shown: Record<string, string> = {};
  for (const [key, message] of Object.entries(client)) {
    const step = stepOfKey(key);
    if (step !== null && flow.tried.includes(step)) shown[key] = message;
  }
  return { ...shown, ...server.errors };
}

function sameErrors(a: Readonly<Record<string, string | undefined>>, b: Readonly<Record<string, string>>): boolean {
  const defined = Object.entries(a).filter(([, value]) => value !== undefined && value !== "");
  return defined.length === Object.keys(b).length && defined.every(([key, value]) => b[key] === value);
}

/** Keep the context's `errors` equal to `shownErrors`: a tried step re-validates live. */
export function useShownErrors(shown: Record<string, string>): void {
  const { errors, setFieldErrors } = useFormContext();
  const key = JSON.stringify(shown);
  useEffect(() => {
    if (!sameErrors(errors, shown)) setFieldErrors(shown);
    // `key` stands for `shown`, which is rebuilt every render.
  }, [key, errors, setFieldErrors]);
}

/** Drop each server error once ITS field changed; one typed elsewhere keeps it. */
export function useDropAnsweredServerErrors(
  server: ServerErrors,
  form: FormSnapshot,
  setServer: (next: (previous: ServerErrors) => ServerErrors) => void,
): void {
  const answered = Object.keys(server.errors).filter((key) => stampOf(key, form) !== server.stamps[key]);
  const key = answered.join(",");
  useEffect(() => {
    if (key === "") return;
    setServer((previous) => {
      const errors = Object.fromEntries(Object.entries(previous.errors).filter(([name]) => !answered.includes(name)));
      const left = Object.keys(errors).length > 0;
      return { ...previous, errors, refused: previous.refused && left };
    });
    // `key` stands for `answered`.
  }, [key, setServer]);
}

/** What a reveal watches: the facts whose change makes a block appear. */
export interface RevealWatch {
  kind: string;
  trigger: string;
  scope: string;
  scheduleEnabled: boolean;
  slots: number;
  windows: number;
}

export function revealWatchOf(form: FormSnapshot): RevealWatch {
  return {
    kind: form.values.kind ?? "",
    trigger: form.values.trigger ?? "",
    scope: form.values.scope ?? "",
    scheduleEnabled: form.scheduleEnabled,
    slots: form.slots.length,
    windows: form.schedule.windows.length,
  };
}

/**
 * The block that just appeared, as a selector, or null (Story "Scroll"): the
 * coupon field, the schedule, a new group, a new window, a scope's picker.
 * Picker popovers are not here: they place themselves.
 */
export function revealTargetOf(previous: RevealWatch, next: RevealWatch): string | null {
  const rule = REVEAL_RULES.find(([appeared]) => appeared(previous, next));
  return rule === undefined ? null : rule[1](next);
}

type RevealRule = readonly [(previous: RevealWatch, next: RevealWatch) => boolean, (next: RevealWatch) => string];

const REVEAL_RULES: readonly RevealRule[] = [
  [(previous, next) => previous.trigger !== "CODE" && next.trigger === "CODE", () => '[data-testid="total-form-field-code"]'],
  [(previous, next) => !previous.scheduleEnabled && next.scheduleEnabled, () => '[data-testid="schedule-builder"]'],
  [
    (previous, next) => next.kind === "COMBO" && previous.kind === "COMBO" && next.slots > previous.slots,
    (next) => `[data-testid="combo-slot-${next.slots - 1}"]`,
  ],
  [
    (previous, next) => next.scheduleEnabled && previous.scheduleEnabled && next.windows > previous.windows,
    (next) => `[data-testid="schedule-window-${next.windows - 1}"]`,
  ],
  [
    (previous, next) =>
      previous.scope !== next.scope && (next.scope === "CATEGORY" || next.scope === "ITEM") && previous.kind === next.kind,
    () => '[data-testid^="discount-"][data-testid$="-targets"]',
  ],
];

/** Reveal, then follow while it settles, the block a change made appear — never on first paint. */
export function useRevealOnAppear(root: RefObject<HTMLElement | null>, watch: RevealWatch, insets: RevealOptions): void {
  const previous = useRef(watch);
  const key = JSON.stringify(watch);
  useEffect(() => {
    const target = revealTargetOf(previous.current, watch);
    previous.current = watch;
    if (target === null) return undefined;
    const element = root.current?.querySelector<HTMLElement>(target) ?? null;
    return followBlock(element, insets);
    // `key` stands for `watch`; the insets read live bars.
  }, [key]);
}
