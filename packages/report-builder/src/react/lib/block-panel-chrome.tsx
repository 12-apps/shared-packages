/**
 * The furniture around the block config form (FUT-755, GAPs 6 and 7).
 *
 * Four pieces, extracted from `block-editor-panel.tsx` because the panel is at
 * the size gate's ceiling and these are what can leave without splitting an
 * idea in half: the panel decides WHERE each sits and what it is pointed at,
 * these decide what each one is.
 *
 * `prototype.html` puts all of them in the panel and this is why:
 *
 *  - **the sentence** answers "what is this block", which the panel previously
 *    did not answer at all — its header said `Bloco`, a word that is true of
 *    every block and therefore says nothing. It is in the header rather than in
 *    the scrolling form because it must still be readable while the author is
 *    at the bottom of the form changing what it describes.
 *  - **the title field** is the override for that sentence, so it sits directly
 *    under it. Empty means "track the spec", which is what the helper text says
 *    in words and the placeholder shows by example.
 *  - **the footer** carries *Duplicar* and *Remover*. The block's own chrome
 *    already has both; a panel that can configure a block but not copy or drop
 *    it sends the author back to the canvas for the two most likely next moves.
 *  - **the empty state** is what the panel shows with nothing selected — a
 *    STATE of a panel that stays docked, not the absence of one.
 */
import { Fragment, type ChangeEvent, type JSX } from "react";

import { Alert } from "@12-apps/ui/data-display/Alert";
import { Button } from "@12-apps/ui/form/Button";
import { Input } from "@12-apps/ui/form/Input";
import { Box } from "@12-apps/ui/mui/Box";
import { Text } from "@12-apps/ui/typography/Text";

import { CONTROL_RADIUS_PX } from "./report-surface";
import type { SentencePart } from "./spec-sentence";
import { useReportCopy } from "../transport-context";

/** What the panel says when nothing is selected — the spec's exact wording. */

const EMPTY_SX = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  py: 6,
  px: 2,
} as const;

/**
 * What the panel shows with nothing selected.
 *
 * It is a STATE of the panel rather than an absence of one: the panel stays
 * docked, so deselecting does not make the canvas jump 344px wider and back
 * the moment the author clicks the next block.
 */
export function BlockPanelEmptyState({ testId }: { testId: string }): JSX.Element {
  const copy = useReportCopy().screens.builder;
  return (
    <Box data-testid={`${testId}-empty`} sx={EMPTY_SX}>
      <Text variant="body" size="sm" color="secondary">
        {copy.emptySelection}
      </Text>
    </Box>
  );
}

/**
 * The tinted box the sentence sits in (`prototype.html`'s `.sentence`).
 *
 * The tint is what makes it read as the panel's ANSWER rather than as the first
 * of the form's hints: the panel surface is paper, and the canvas grey the rest
 * of the reports area uses is already the "this is a surface, not a control"
 * colour here. It is set at the CONTROL radius because it is inside a container,
 * which is the two-value rule `visual-pass.md` §Components asks for.
 */
const SENTENCE_SX = {
  // The drawer's paper is a flex column whose scrolling half takes the slack;
  // without this the sentence would be squeezed by a long form rather than the
  // form scrolling under it.
  flex: "0 0 auto",
  px: 2,
  pt: 0,
  pb: 1.5,
} as const;

const SENTENCE_BOX_SX = {
  bgcolor: "grey.100",
  borderRadius: `${CONTROL_RADIUS_PX}px`,
  px: 1.25,
  py: 1,
  fontSize: "0.8125rem",
  lineHeight: 1.55,
  color: "text.secondary",
} as const;

/**
 * The terms the author actually chose, at the one step of emphasis.
 *
 * Rendered as `<strong>` rather than as a styled `<span>`: the emphasis is a
 * fact about the sentence — these are the words the author picked, the rest is
 * grammar — so it belongs in the markup and survives with the text wherever it
 * is copied. `prototype.html` uses `<b>`; `<strong>` is the same weight and
 * says why.
 */
const STRONG_SX = { color: "text.primary", fontWeight: 600 } as const;

/**
 * What this block asks for, with the author's own terms picked out.
 *
 * The full stop is added HERE rather than by `specSentence`, which leaves it
 * off on purpose — the same sentence is a block subtitle and a PDF caption
 * elsewhere, where a full stop is wrong as often as it is right. In a panel
 * that presents it as a statement, it is right.
 */
export function BlockSpecSentence({
  parts,
  testId,
}: {
  parts: SentencePart[];
  testId: string;
}): JSX.Element {
  return (
    <Box sx={SENTENCE_SX}>
      <Box sx={SENTENCE_BOX_SX} data-testid={`${testId}-sentence`}>
        {parts.map((part, index) =>
          part.strong ? (
            <Box
              component="strong"
              // The index is part of the identity: these are runs of ONE
              // string, so two runs reading the same are different words in it.
              key={`${index}-${part.text}`}
              sx={STRONG_SX}
            >
              {part.text}
            </Box>
          ) : (
            <Fragment key={`${index}-${part.text}`}>{part.text}</Fragment>
          ),
        )}
        .
      </Box>
    </Box>
  );
}

/**
 * The block's title override.
 *
 * `InputLabelProps.shrink` pins the label up so the PLACEHOLDER is visible at
 * rest — MUI hides a placeholder behind an unshrunk floating label, and the
 * placeholder is the point here: it shows the author the name the block already
 * has, so the field reads as "this is what it is called, change it if you like"
 * rather than as an empty required box.
 *
 * The test id deliberately does NOT end in `-title`: `EDITOR_SURFACE_SX` styles
 * `input[data-testid$="-title"]` as the block's own heading slot — 18px, weight
 * 600, borderless — and this is a form field in a column of form fields.
 */
export function BlockTitleField({
  title,
  autoTitle,
  onTitleChange,
  testId,
}: {
  title: string;
  autoTitle: string;
  onTitleChange: (title: string) => void;
  testId: string;
}): JSX.Element {
  const copy = useReportCopy().screens.builder;
  return (
    <Input
      size="sm"
      label={copy.blockTitleLabel}
      value={title}
      placeholder={autoTitle}
      helperText={copy.blockTitleHelper(autoTitle)}
      InputLabelProps={{ shrink: true }}
      onChange={(event: ChangeEvent<HTMLInputElement>) => onTitleChange(event.target.value)}
      data-testid={`${testId}-title-override`}
    />
  );
}

const FOOTER_SX = {
  flex: "0 0 auto",
  borderTop: 1,
  borderColor: "divider",
  px: 2,
  py: 1.25,
  display: "flex",
  flexDirection: "column",
  gap: 1,
} as const;

const FOOTER_ROW_SX = { display: "flex", gap: 1, alignItems: "center" } as const;

/** Refused, and saying so — never merely grey. See the button's own comment. */
const BLOCKED_SX = { opacity: 0.55, cursor: "not-allowed" } as const;

/**
 * *Duplicar* and *Remover*, at the bottom of the panel.
 *
 * Neither is implemented here. Both are a SECOND ENTRY POINT to something the
 * canvas already does — *Remover* in particular goes through the very same
 * confirmation as the block's 🗑, because the canvas owns that one dialog and
 * this only asks it to open. A panel that confirmed removal its own way would
 * be a second behaviour wearing the first one's name.
 *
 * At the block ceiling *Duplicar* is `aria-disabled` rather than `disabled`.
 * A genuinely disabled button leaves the tab order and swallows pointer events
 * in most browsers, so the explanation for why it will not work would sit
 * behind an interaction the people who need it cannot perform — the same
 * reasoning, and the same shape, as the visualization picker's blocked tiles.
 */
export function BlockPanelFooter({
  canDuplicate,
  blockedReason,
  onDuplicate,
  onRemove,
  testId,
}: {
  canDuplicate: boolean;
  /** Why duplication is refused; shown whenever `canDuplicate` is false. */
  blockedReason: string;
  onDuplicate: () => void;
  onRemove: () => void;
  testId: string;
}): JSX.Element {
  const copy = useReportCopy().screens.builder;
  const reasonId = `${testId}-duplicate-reason`;
  return (
    <Box sx={FOOTER_SX} data-testid={`${testId}-footer`}>
      {canDuplicate ? null : (
        // Always on screen, not on hover: there is exactly one refusable
        // control here and one reason, so there is nothing to reveal
        // progressively and no room for a reader to miss it. `role="note"`
        // with no live region — the button carries the same sentence as its
        // description, and announcing both would say it twice.
        <Alert
          variant="warning"
          showIcon={false}
          animate={false}
          role="note"
          aria-live="off"
          tabIndex={-1}
          id={reasonId}
          data-testid={reasonId}
          sx={{ fontSize: "0.75rem", py: 0.5 }}
        >
          {blockedReason}
        </Alert>
      )}
      <Box sx={FOOTER_ROW_SX}>
        <Button
          variant="outline"
          size="sm"
          aria-disabled={canDuplicate ? undefined : true}
          aria-describedby={canDuplicate ? undefined : reasonId}
          title={canDuplicate ? undefined : blockedReason}
          sx={canDuplicate ? undefined : BLOCKED_SX}
          onClick={canDuplicate ? onDuplicate : undefined}
          dataTestId={`${testId}-duplicate`}
        >
          Duplicar
        </Button>
        <Button
          variant="outline"
          color="danger"
          size="sm"
          onClick={onRemove}
          dataTestId={`${testId}-remove`}
        >
          {copy.remove}
        </Button>
      </Box>
    </Box>
  );
}
