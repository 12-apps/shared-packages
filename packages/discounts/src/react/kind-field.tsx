"use client";

import { useLayoutEffect, useRef, useState, type JSX, type RefObject } from "react";

import { Fields } from "@12-apps/ui/form/total-form";
import { Box } from "@12-apps/ui/mui/Box";

import type { DiscountsWebCopy } from "./copy";
import { optionsFor } from "./discount-form-fields";
import type { DiscountKind } from "./form-kind";

/**
 * What kind of promotion this is — the form's first and most consequential
 * question, and the only one that decides what the rest of it looks like.
 *
 * The option list comes from the caller rather than from the constant, because
 * it is one longer when a legacy `BUNDLE_PRICE` rule is being edited.
 *
 * **One line, at every width** (FUT-4157, ADR 0190 in the host). Four equal
 * parts need about 530 px before "Porcentagem" and "Itens grátis" wrap inside
 * their buttons; at 320 and 390 the toggle wrapped every label AND pushed the
 * page to 422 px. Where the FORM is narrower than its parts need, the same
 * question is asked with a select: same field, same options in the same order,
 * same refusal painted under it. What is measured is the form's own width, not
 * the window's — the form also lives in a dialog narrower than the screen.
 */

/** The widest pt-BR kind label at the toggle's type size (132 px measured), plus its padding. */
const PART_MIN_PX = 136;

/** The element's own width as it changes; `null` until measured, or where nothing can measure. */
function useElementWidth(ref: RefObject<HTMLElement | null>): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width;
      if (measured !== undefined && measured > 0) setWidth(measured);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

export function KindField({
  copy,
  kinds,
}: {
  copy: DiscountsWebCopy;
  kinds: readonly DiscountKind[];
}): JSX.Element {
  const box = useRef<HTMLDivElement>(null);
  const width = useElementWidth(box);
  const options = optionsFor(kinds, copy.labels.kind);
  const fits = width === null || width >= kinds.length * PART_MIN_PX;
  return (
    <Box ref={box} sx={{ minWidth: 0 }}>
      {fits ? (
        <Fields.ToggleField name="kind" label={copy.form.kind} options={options} />
      ) : (
        <Fields.SelectField name="kind" label={copy.form.kind} options={options} />
      )}
    </Box>
  );
}
