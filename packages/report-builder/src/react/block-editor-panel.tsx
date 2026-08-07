/**
 * The block's ✎ config surface (FUT-391): a right-hand PANEL on desktop, a
 * bottom SHEET on a narrow screen.
 *
 * It replaces a popover, for two reasons the popover could not fix:
 *
 * 1. **It covered the block it configured.** The preview re-runs live on every
 *    keystroke, which is worth nothing when the thing being previewed is
 *    behind the form. A panel sits beside the canvas, so the block stays
 *    visible while its spec changes.
 * 2. **It truncated its own controls.** At 360px wide the labels rendered as
 *    `St…` and `igu…` — a filter row the author cannot read is a filter row
 *    they cannot trust. Full height and a fixed 344px give every control its
 *    label.
 *
 * The test ids are unchanged from the popover on purpose: `report-block-<id>-editor`
 * and `-editor-entity` are driven by future-pay's reports e2e, so swapping the
 * container must not break a consumer's suite.
 */
import { useState, type JSX, type RefObject } from "react";

import { Drawer, DrawerContent, DrawerHeader } from "@12-apps/ui/layout/Drawer";
import { Box } from "@12-apps/ui/mui/Box";
import useMediaQuery from "@12-apps/ui/mui/useMediaQuery";
import { Text } from "@12-apps/ui/typography/Text";

import { BlockQueryFields, fieldMapOf } from "./block-query-fields";
import { draftFromSpec, specFromDraft, withValidChart, type BuilderDraft } from "./builder-model";
import type { ReportEntityFields, ReportSpecWire } from "./custom-reports-api";

/**
 * Below this the panel becomes a bottom sheet. It is the FORM's threshold, not
 * a page breakpoint: a 344px panel beside a canvas needs roughly this much
 * room before the canvas it is meant to keep visible stops being visible.
 */
const SHEET_BELOW_PX = 760;

/** Wide enough that a filter's three controls read in full (FUT-391). */
const PANEL_WIDTH_PX = 344;

/** Leaves the canvas peeking above the sheet, so the edit still has context. */
const SHEET_HEIGHT = "78vh";

export function BlockEditorPanel({
  open,
  onClose,
  restoreFocusTo,
  entities,
  spec,
  span,
  onChange,
  onSpanChange,
  testId,
}: {
  open: boolean;
  onClose: () => void;
  /**
   * The control that opened the panel. Focus returns to it on close — without
   * that, focus falls to the document and a keyboard user closing the panel
   * restarts from the top of the page.
   */
  restoreFocusTo?: RefObject<HTMLElement | null>;
  entities: ReportEntityFields[];
  spec: ReportSpecWire;
  span: number;
  onChange: (spec: ReportSpecWire) => void;
  onSpanChange: (span: number) => void;
  testId: string;
}): JSX.Element {
  // Seeded once per opening (the caller remounts via `key`): the draft keeps
  // half-finished rows — a blank "+ Medida" line, a filter with no value yet —
  // that the serialized spec necessarily drops.
  const [draft, setDraft] = useState<BuilderDraft>(() => draftFromSpec("", "", spec));
  const asSheet = useMediaQuery(`(max-width:${SHEET_BELOW_PX - 1}px)`);

  const close = (): void => {
    onClose();
    restoreFocusTo?.current?.focus();
  };

  const apply = (next: BuilderDraft): void => {
    const map = fieldMapOf(entities.find((candidate) => candidate.entity === next.entity));
    const valid = withValidChart(next, map);
    setDraft(valid);
    onChange(specFromDraft(valid, map));
  };

  return (
    <Drawer
      open={open}
      onClose={close}
      anchor={asSheet ? "bottom" : "right"}
      width={asSheet ? "100%" : PANEL_WIDTH_PX}
      height={asSheet ? SHEET_HEIGHT : undefined}
      dataTestId={testId}
    >
      <DrawerHeader onClose={close} dataTestId={`${testId}-header`}>
        <Text variant="heading" size="sm" as="h2">
          Bloco
        </Text>
      </DrawerHeader>
      <DrawerContent dataTestId={`${testId}-content`}>
        {/* Scrolls inside the panel: the header and its close control stay
            reachable however long the form gets. */}
        <Box sx={{ overflowY: "auto", pb: 2 }}>
          <BlockQueryFields
            draft={draft}
            entities={entities}
            span={span}
            apply={apply}
            onSpanChange={onSpanChange}
            testId={testId}
          />
        </Box>
      </DrawerContent>
    </Drawer>
  );
}
