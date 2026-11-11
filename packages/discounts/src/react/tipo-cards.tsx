"use client";

import { useLayoutEffect, useRef, useState, type JSX, type KeyboardEvent, type RefObject } from "react";

import { FormLabel } from "@12-apps/ui/form/Form";
import { useFormContext } from "@12-apps/ui/form/total-form";
import { Box } from "@12-apps/ui/mui/Box";
import { sxRem } from "@12-apps/ui/tokens";
import { Text } from "@12-apps/ui/typography/Text";

import type { CompleteDiscountsWebCopy } from "./copy";
import { DISCOUNT_KINDS, type DiscountKind } from "./form-kind";
import { useElementWidth } from "./kind-field";

/**
 * "Tipo de promoção" as four cards, each with an example line (FUT-4475,
 * "Tipo"): a `radiogroup` of four `radio`s, which replaces `KindField`'s
 * toggle-or-select inside the step form.
 *
 * **One row of four, or one column — never two rows of two** (ADR 0190). What
 * is measured is the FORM's width, never the window's (the form lives in a
 * modal, FUT-4157): the cards sit in a row while each gets at least the width
 * its own title and example need on one line, and stack otherwise. The same
 * measure is what the form's side column is derived from (`asideMinPx`).
 */

/** The cards' gap, `gap: 1`. */
const CARD_GAP_PX = 8;

/**
 * What one card needs, when nothing could measure it (a test DOM): the widest
 * pt-BR kind label at the toggle's type size, 132 px, as `KindField` measured.
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
  clone.querySelectorAll<HTMLElement>("[data-example]").forEach((line) => line.remove());
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

function nextKind(kinds: readonly DiscountKind[], current: number, key: string): number | null {
  if (key === "ArrowRight" || key === "ArrowDown") return (current + 1) % kinds.length;
  if (key === "ArrowLeft" || key === "ArrowUp") return (current - 1 + kinds.length) % kinds.length;
  if (key === "Home") return 0;
  if (key === "End") return kinds.length - 1;
  return null;
}

/** One card: a radio with the kind's name and its example line. */
function TipoCard({
  copy,
  kind,
  on,
  onPick,
}: {
  copy: CompleteDiscountsWebCopy;
  kind: DiscountKind;
  on: boolean;
  onPick: () => void;
}): JSX.Element {
  return (
    <Box
      component="button"
      type="button"
      role="radio"
      aria-checked={on}
      tabIndex={on ? 0 : -1}
      onClick={onPick}
      data-testid={`discount-kind-${kind}`}
      sx={{
        display: "flex",
        gap: 1.5,
        alignItems: "flex-start",
        textAlign: "left",
        minWidth: 0,
        minHeight: sxRem(44),
        px: 1.75,
        py: 1.5,
        font: "inherit",
        color: "text.primary",
        cursor: "pointer",
        borderRadius: sxRem(10),
        border: 1,
        borderColor: on ? "primary.main" : "divider",
        boxShadow: (theme) => (on ? `inset 0 0 0 1px ${theme.palette.primary.main}` : "none"),
        bgcolor: on ? "action.selected" : "background.paper",
        "&:focus-visible": { outline: 2, outlineColor: "primary.main", outlineOffset: 2 },
      }}
    >
      <Box
        aria-hidden
        sx={{
          flexShrink: 0,
          mt: sxRem(1),
          width: sxRem(18),
          height: sxRem(18),
          borderRadius: "50%",
          borderStyle: "solid",
          borderWidth: on ? sxRem(6) : sxRem(2),
          borderColor: on ? "primary.main" : "text.secondary",
        }}
      />
      <Box sx={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 0.25 }}>
        <Text as="span" weight="semibold" size="sm">
          {copy.labels.kind[kind]}
        </Text>
        <Text as="span" variant="caption" data-example="">
          {copy.steps.kindExamples[kind]}
        </Text>
      </Box>
    </Box>
  );
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
  const kinds = DISCOUNT_KINDS;
  const chosen = Math.max(0, kinds.indexOf((values.kind ?? "PERCENTAGE") as DiscountKind));

  const pick = (index: number, focus: boolean): void => {
    const kind = kinds[index] as DiscountKind;
    if (focus) group.current?.querySelectorAll<HTMLElement>('[role="radio"]')[index]?.focus();
    if (kind === values.kind) return;
    setFieldValue("kind", kind);
    onKindChange(kind);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const next = nextKind(kinds, chosen, event.key);
    if (next === null) return;
    event.preventDefault();
    pick(next, true);
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
      <FormLabel>{copy.form.kind}</FormLabel>
      <Box
        ref={group}
        role="radiogroup"
        aria-label={copy.form.kind}
        onKeyDown={onKeyDown}
        data-testid="discount-kind-cards"
        data-layout={row ? "row" : "column"}
        sx={{ display: "grid", gap: 1, gridTemplateColumns: row ? `repeat(${kinds.length}, minmax(0, 1fr))` : "1fr" }}
      >
        {kinds.map((kind, index) => (
          <TipoCard key={kind} copy={copy} kind={kind} on={index === chosen} onPick={() => pick(index, false)} />
        ))}
      </Box>
    </Box>
  );
}
