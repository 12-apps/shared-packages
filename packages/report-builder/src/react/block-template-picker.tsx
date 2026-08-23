import { useEffect, useRef, type JSX } from "react";

import { Modal, ModalContent } from "@12-apps/ui/feedback/Modal";
import { Button } from "@12-apps/ui/form/Button";
import { Card } from "@12-apps/ui/layout/Card";
import { Box } from "@12-apps/ui/mui/Box";
import { Stack } from "@12-apps/ui/mui/Stack";
import { alpha } from "@12-apps/ui/mui/styles";
import { Text } from "@12-apps/ui/typography/Text";

import type { BlockTemplate, BlockTemplateGroup } from "../server/block-templates";
import { CONTAINER_RADIUS_PX, CONTROL_RADIUS_PX, SECTION_LABEL_STYLE } from "./lib/report-surface";
import { useReportCopy } from "./transport-context";

/**
 * A template is a CARD, and dismissing is not.
 *
 * Every template used to render as a full-width outlined `Button` — and so did
 * *Cancelar*, at the bottom of the same column. Nine identically-shaped bars,
 * one of which throws the whole interaction away: the dismiss was
 * indistinguishable from the eight choices, which is exactly what
 * `inventory.md` §1 flags ("the prototype's templates are cards, ours are
 * buttons"). Cards in a grid say "pick one of these"; a ghost button in the
 * footer says "or don't".
 *
 * The card is still a real `<button>` underneath — the templates were already
 * keyboard-reachable and announced, and card-ifying them must not cost that.
 */
const TEMPLATE_CARD_SX = {
  p: 0,
  width: "100%",
  minWidth: 0,
  textAlign: "left",
  textTransform: "none",
  boxShadow: "none",
  border: 0,
  borderRadius: `${CONTAINER_RADIUS_PX}px`,
  bgcolor: "transparent",
  "&:hover": { bgcolor: "transparent" },
} as const;

const TEMPLATE_CARD_INNER_SX = {
  p: 1.5,
  height: "100%",
  width: "100%",
  boxShadow: "none",
  borderRadius: `${CONTAINER_RADIUS_PX}px`,
  bgcolor: "background.paper",
  transition: "border-color .12s, background-color .12s",
  ".MuiButtonBase-root:hover &": { borderColor: "primary.main", bgcolor: "action.hover" },
} as const;

/**
 * Three across where there is room, then two, then one.
 *
 * `prototype.html`'s `.tpl-grid` is `auto-fill, minmax(216px, 1fr)`, which
 * lands on three columns in its 760px modal. Stated as explicit tiers instead
 * of a minimum, because this modal's width is a token rather than a number:
 * `auto-fill` against a 216px floor would silently drop to two columns the day
 * the modal's size preset changed, and nothing would say so.
 */
const TEMPLATE_GRID_SX = {
  display: "grid",
  gap: 1,
  gridTemplateColumns: {
    xs: "1fr",
    sm: "repeat(2, minmax(0, 1fr))",
    md: "repeat(3, minmax(0, 1fr))",
  },
} as const;

/** The dismiss sits alone on its own line, in the tone of a link rather than a choice. */
const FOOTER_SX = { flexDirection: "row", justifyContent: "flex-end" } as const;

/** The square that carries a template's glyph — `prototype.html`'s `.tpl .ic`. */
const ICON_TILE_SX = {
  width: 30,
  height: 30,
  flex: "none",
  display: "grid",
  placeItems: "center",
  borderRadius: `${CONTROL_RADIUS_PX}px`,
  color: "primary.main",
  bgcolor: (theme: { palette: { primary: { main: string } } }) =>
    alpha(theme.palette.primary.main, 0.12),
} as const;

/** Bars — "this template draws you something". */
const CHART_GLYPH = "M6 19V11M12 19V5M18 19v-6";
/** A plus — the blank template BUILDS rather than draws, and says so. */
const PLUS_GLYPH = "M12 5v14M5 12h14";

/**
 * The tile's glyph, as one `<svg>` with a swapped path.
 *
 * Two components would be two nearly identical SVGs; one component with a
 * `path` prop is the same picture with the one difference named.
 */
function TileGlyph({ path }: { path: string }): JSX.Element {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={path} />
    </svg>
  );
}

/**
 * One template: an icon tile, a name, and the one line that says what it
 * answers.
 *
 * The blank template takes the PLUS rather than the chart glyph, because it is
 * the only entry that does not produce a picture — it produces an empty query
 * to fill in. `spec === null` is what "blank" means in the model, so the icon
 * follows the model rather than a second list of ids that could disagree.
 */
function TemplateTile({
  template,
  testId,
  cardRef,
  onSelect,
}: {
  template: BlockTemplate;
  testId: string;
  cardRef?: React.Ref<HTMLButtonElement>;
  onSelect: () => void;
}): JSX.Element {
  const copy = useReportCopy().screens.builder;
  return (
    <Button
      ref={cardRef}
      variant="text"
      color="neutral"
      size="sm"
      onClick={onSelect}
      sx={TEMPLATE_CARD_SX}
      data-testid={testId}
      // The description is the reason to pick this one, so it is part of the
      // control's name rather than adjacent text a screen reader announces
      // separately (or not at all).
      aria-label={copy.templateOption(template.title, template.description)}
    >
      <Card variant="outlined" sx={TEMPLATE_CARD_INNER_SX}>
        <Stack direction="row" spacing={1.25} sx={{ alignItems: "flex-start", width: "100%" }}>
          <Box sx={ICON_TILE_SX} data-testid={`${testId}-icon`}>
            <TileGlyph path={template.spec === null ? PLUS_GLYPH : CHART_GLYPH} />
          </Box>
          <Stack spacing={0.25} sx={{ alignItems: "flex-start", textAlign: "left", minWidth: 0 }}>
            <Text variant="body" size="sm" weight="semibold">
              {template.title}
            </Text>
            <Text variant="body" size="xs" color="secondary">
              {template.description}
            </Text>
          </Stack>
        </Stack>
      </Card>
    </Button>
  );
}

/**
 * One group: an EYEBROW and its tiles.
 *
 * The heading reuses {@link SECTION_LABEL_STYLE} — the uppercase, letterspaced
 * treatment `visual-pass.md` §Type gives every section label in this area —
 * rather than inventing a second one. `VENDAS` and a template title are then
 * different KINDS of label, which reads at a glance where a 1px size difference
 * does not.
 */
function TemplateGroupSection({
  group,
  testId,
  firstRef,
  onSelect,
}: {
  group: BlockTemplateGroup;
  testId: string;
  /** Set on the very first tile of the very first group, for focus on open. */
  firstRef?: React.Ref<HTMLButtonElement>;
  onSelect: (template: BlockTemplate) => void;
}): JSX.Element {
  return (
    <Stack spacing={1}>
      <Text
        variant="heading"
        size="xs"
        color="secondary"
        as="h3"
        style={SECTION_LABEL_STYLE}
        data-testid={`${testId}-group-${group.id}`}
      >
        {group.title}
      </Text>
      <Box sx={TEMPLATE_GRID_SX}>
        {group.templates.map((template, index) => (
          <TemplateTile
            key={template.id}
            template={template}
            testId={`${testId}-${template.id}`}
            {...(firstRef && index === 0 ? { cardRef: firstRef } : {})}
            onSelect={() => onSelect(template)}
          />
        ))}
      </Box>
    </Stack>
  );
}

/**
 * "Adicionar bloco": pick something to look at, rather than get an empty block
 * and a config panel to decode (FUT-391).
 *
 * The groups come from the SERVER — every template's spec is compile-validated
 * against the live catalog — so this component chooses only how they are
 * presented, never what they are. A template that stopped compiling would fail
 * the package's own suite before it reached here.
 *
 * Selection returns the whole template, not just an id. The caller needs the
 * spec to build the block, and re-looking-it-up by id gives two places that
 * can disagree about which template a click meant.
 */
export function BlockTemplatePicker({
  open,
  groups,
  onSelect,
  onClose,
  testId = "block-template-picker",
}: {
  open: boolean;
  groups: readonly BlockTemplateGroup[];
  onSelect: (template: BlockTemplate) => void;
  onClose: () => void;
  testId?: string;
}): JSX.Element {
  const copy = useReportCopy().screens.builder;
  const firstRef = useRef<HTMLButtonElement | null>(null);

  // Focus the first template on open. Without this, focus stays on the trigger
  // behind the backdrop: a keyboard user tabs through the page underneath and
  // never reaches the dialog they just opened.
  useEffect(() => {
    if (open) firstRef.current?.focus();
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} size="md" dataTestId={testId}>
      <ModalContent dataTestId={`${testId}-content`}>
        <Stack spacing={3}>
          <Stack spacing={0.5}>
            <Text variant="heading" size="lg" weight="semibold" as="h2">
              {copy.templateTitle}
            </Text>
            {/* The line the picker was missing. It answers the question a
             * grid of eight named things provokes — "am I committing to
             * one?" — before it is asked. */}
            <Text variant="body" size="sm" color="secondary" data-testid={`${testId}-subtitle`}>
              {copy.templateHint}
            </Text>
          </Stack>

          {groups.map((group, index) => (
            <TemplateGroupSection
              key={group.id}
              group={group}
              testId={testId}
              {...(index === 0 ? { firstRef } : {})}
              onSelect={onSelect}
            />
          ))}

          <Stack sx={FOOTER_SX}>
            <Button
              variant="ghost"
              color="neutral"
              size="sm"
              onClick={onClose}
              sx={{ borderRadius: `${CONTROL_RADIUS_PX}px` }}
              data-testid={`${testId}-cancel`}
            >
              {copy.cancel}
            </Button>
          </Stack>
        </Stack>
      </ModalContent>
    </Modal>
  );
}
