"use client";

import { useId, useState } from "react";

import type { BaseListCardProps } from "./base-list-card";

/**
 * The row's open state, whether it owns it or the list does.
 *
 * Controlled the moment `expanded` is passed, so a list imposing an accordion
 * is never fighting a second copy of the truth inside each row. Uncontrolled
 * otherwise, and rows then open independently — which is what comparing two
 * records side by side actually needs.
 */
export function useDisclosure(props: BaseListCardProps): {
  expandable: boolean;
  expanded: boolean;
  toggle: () => void;
  regionId: string;
} {
  const [own, setOwn] = useState(props.defaultExpanded ?? false);
  // CONTROLLED ONLY WITH AN OWNER. `expanded` without `onExpandedChange` is a
  // value nothing can ever change — the chevron would move nothing and the row
  // would look broken. Storybook can persist a stray arg into a URL and produce
  // exactly that, so the pair is required before the card gives up its state.
  const controlled = props.expanded != null && props.onExpandedChange != null;
  const expanded = controlled ? props.expanded === true : own;
  // `useId` rather than a counter: the id has to survive an SSR pass and match
  // on hydration, or `aria-controls` points at nothing on the first paint.
  const regionId = useId();
  return {
    expandable: props.children != null,
    expanded,
    regionId,
    toggle: () => {
      if (!controlled) setOwn((open) => !open);
      props.onExpandedChange?.(!expanded);
    },
  };
}
