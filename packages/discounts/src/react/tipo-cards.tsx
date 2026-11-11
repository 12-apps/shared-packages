"use client";

import { useLayoutEffect, useRef, useState, type JSX, type RefObject } from "react";

import { FormLabel } from "@12-apps/ui/form/Form";
import { RadioGroup } from "@12-apps/ui/form/RadioGroup";
import { useFormContext } from "@12-apps/ui/form/total-form";
import { Box } from "@12-apps/ui/mui/Box";

import type { CompleteDiscountsWebCopy } from "./copy";
import { DISCOUNT_KINDS, type DiscountKind } from "./form-kind";
import { useElementWidth } from "./kind-field";

/**
 * "Tipo de promoção" as four cards, each with an example line (FUT-4475,
 * "Tipo"): the library's `RadioGroup variant="cards"` — a `radiogroup` of four
 * `radio`s with the keyboard of native radios — which replaces `KindField`'s
 * toggle-or-select inside the step form.
 *
 * **One row of four, or one column — never two rows of two** (ADR 0190). What
 * is measured is the FORM's width, never the window's (the form lives in a
 * modal, FUT-4157): the cards sit in a row while each gets at least the width
 * its own title needs on one line, and stack otherwise. The same measure is
 * what the form's side column is derived from (`asideMinPx`).
 */

/** The cards' gap: the library's compact (`size="sm"`) `gap: 1`. */
const CARD_GAP_PX = 8;

/**
 * What one card needs, when nothing could measure it (a test DOM): the widest
 * pt-BR kind label at the old toggle's type size, 132 px, as measured for FUT-4157.
 */
export const FALLBACK_CARD_PX = 132;

/** The row of four's minimum width, from one card's. */
export function rowMinPx(cardPx: number, count: number = DISCOUNT_KINDS.length): number {
  return Math.ceil(cardPx * count + CARD_GAP_PX * (count - 1));
}

/**
 * A card's width with its NAME on one line: a hidden clone, measured beside
 * it. The example line under the name may wrap — the prototype's own cards
 * wrap it at 1280 — so the clone leaves it out.
 */
function naturalWidth(card: HTMLElement): number {
  const clone = card.cloneNode(true) as HTMLElement;
  Object.assign(clone.style, { position: "absolute", visibility: "hidden", width: "auto", minWidth: "0", whiteSpace: "nowrap" });
  clone.querySelectorAll<HTMLElement>("[data-description]").forEach((line) => line.remove());
  (card.parentElement ?? document.body).appendChild(clone);
  const width = clone.getBoundingClientRect().width;
  clone.remove();
  return width;
}

/** The widest card's one-line width, measured once the cards are on screen. */
function useCardWidth(group: RefObject<HTMLElement | null>, onRowMin: ((px: number) => void) | undefined): number {
  const [measured, setMeasured] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (measured !== null || group.current === null) return;
    const cards = [...group.current.querySelectorAll<HTMLElement>('[role="radio"]')];
    const widest = Math.max(0, ...cards.map(naturalWidth));
    if (widest <= 0) return;
    // +1 px: sub-pixel widths round the other way often enough to wrap.
    setMeasured(Math.ceil(widest + 1));
  });
  const card = measured ?? FALLBACK_CARD_PX;
  useLayoutEffect(() => onRowMin?.(rowMinPx(card)), [card, onRowMin]);
  return card;
}

export function TipoCards({
  copy,
  onKindChange,
  onRowMin,
}: {
  copy: CompleteDiscountsWebCopy;
  /** Any change of Tipo: the steps after it ask a different question now. */
  onKindChange: (kind: DiscountKind) => void;
  /** The row of four's measured minimum, for the side column's threshold. */
  onRowMin?: (px: number) => void;
}): JSX.Element {
  const { values, setFieldValue } = useFormContext();
  const group = useRef<HTMLDivElement>(null);
  const width = useElementWidth(group);
  const card = useCardWidth(group, onRowMin);
  const row = width === null || width >= rowMinPx(card);
  const kind = (values.kind ?? "PERCENTAGE") as DiscountKind;
  const options = DISCOUNT_KINDS.map((each) => ({
    value: each,
    label: copy.labels.kind[each],
    description: copy.steps.kindExamples[each],
    dataTestId: `discount-kind-${each}`,
  }));
  return (
    <Box ref={group} data-testid="discount-kind-cards" data-layout={row ? "row" : "column"} sx={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 0.75 }}>
      {/* The form's own field label, as "Nome da promoção" above it; the group is named by it. */}
      <FormLabel>{copy.form.kind}</FormLabel>
      <RadioGroup
        variant="cards"
        indicator
        size="sm"
        aria-label={copy.form.kind}
        direction={row ? "row" : "column"}
        options={options}
        value={kind}
        onChange={(_event, next) => {
          if (next === kind) return;
          setFieldValue("kind", next);
          onKindChange(next as DiscountKind);
        }}
        dataTestId="discount-kind"
      />
    </Box>
  );
}
