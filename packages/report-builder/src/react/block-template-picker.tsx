import { useEffect, useRef, type JSX } from "react";

import { Modal, ModalContent } from "@12-apps/ui/feedback/Modal";
import { Button } from "@12-apps/ui/form/Button";
import { Card } from "@12-apps/ui/layout/Card";
import { Box } from "@12-apps/ui/mui/Box";
import { Stack } from "@12-apps/ui/mui/Stack";
import { Text } from "@12-apps/ui/typography/Text";

import type { BlockTemplate, BlockTemplateGroup } from "../server/block-templates";
import { CONTAINER_RADIUS_PX, CONTROL_RADIUS_PX } from "./lib/report-surface";

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

/** Two per row where there is room, one where there is not. */
const TEMPLATE_GRID_SX = {
  display: "grid",
  gap: 1,
  gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))" },
} as const;

/** The dismiss sits alone on its own line, in the tone of a link rather than a choice. */
const FOOTER_SX = { flexDirection: "row", justifyContent: "flex-end" } as const;

function TemplateCard({
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
      aria-label={`${template.title} — ${template.description}`}
    >
      <Card variant="outlined" sx={TEMPLATE_CARD_INNER_SX}>
        <Stack spacing={0.25} sx={{ alignItems: "flex-start", textAlign: "left" }}>
          <Text variant="body" size="sm" weight="semibold">
            {template.title}
          </Text>
          <Text variant="body" size="xs" color="secondary">
            {template.description}
          </Text>
        </Stack>
      </Card>
    </Button>
  );
}

/**
 * "Adicionar bloco": pick something to look at, rather than get an empty block
 * and a config panel to decode (FUT-391).
 *
 * The groups come from the SERVER — every template's spec is a starter that is
 * compile-validated against the live catalog — so this component chooses only
 * how they are presented, never what they are. A template that stopped
 * compiling would fail the package's own suite before it reached here.
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
          <Text variant="heading" size="lg" weight="semibold" as="h2">
            Adicionar bloco
          </Text>

          {groups.map((group, groupIndex) => (
            <Stack key={group.id} spacing={1}>
              <Text variant="body" size="xs" color="secondary" as="h3">
                {group.title}
              </Text>
              <Box sx={TEMPLATE_GRID_SX}>
                {group.templates.map((template, templateIndex) => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    testId={`${testId}-${template.id}`}
                    {...(groupIndex === 0 && templateIndex === 0 ? { cardRef: firstRef } : {})}
                    onSelect={() => onSelect(template)}
                  />
                ))}
              </Box>
            </Stack>
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
              Cancelar
            </Button>
          </Stack>
        </Stack>
      </ModalContent>
    </Modal>
  );
}
