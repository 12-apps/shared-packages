import { useEffect, useRef, type JSX } from "react";

import { Modal, ModalContent } from "@12-apps/ui/feedback/Modal";
import { Button } from "@12-apps/ui/form/Button";
import { Stack } from "@12-apps/ui/mui/Stack";
import { Text } from "@12-apps/ui/typography/Text";

import type { BlockTemplate, BlockTemplateGroup } from "../server/block-templates";

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
          <Text variant="heading" size="sm" as="h2">
            Adicionar bloco
          </Text>

          {groups.map((group, groupIndex) => (
            <Stack key={group.id} spacing={1}>
              <Text variant="heading" size="xs" as="h3">
                {group.title}
              </Text>
              <Stack spacing={1}>
                {group.templates.map((template, templateIndex) => (
                  <Button
                    key={template.id}
                    ref={groupIndex === 0 && templateIndex === 0 ? firstRef : undefined}
                    variant="outline"
                    size="sm"
                    onClick={() => onSelect(template)}
                    data-testid={`${testId}-${template.id}`}
                    // The description is the reason to pick this one, so it is
                    // part of the control's name rather than adjacent text a
                    // screen reader announces separately (or not at all).
                    aria-label={`${template.title} — ${template.description}`}
                  >
                    <Stack spacing={0.25} sx={{ alignItems: "flex-start", textAlign: "left" }}>
                      <Text variant="body" size="sm">
                        {template.title}
                      </Text>
                      <Text variant="body" size="xs" color="secondary">
                        {template.description}
                      </Text>
                    </Stack>
                  </Button>
                ))}
              </Stack>
            </Stack>
          ))}

          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            data-testid={`${testId}-cancel`}
          >
            Cancelar
          </Button>
        </Stack>
      </ModalContent>
    </Modal>
  );
}
