"use client";

/**
 * The confirmation in front of "Excluir visão".
 *
 * Deleting was immediate: one click in a row menu, on a control sitting
 * directly under four harmless toggles, and the view was gone. A saved view is
 * somebody's filters, columns and sort — cheap to rebuild only if you remember
 * what they were.
 *
 * It names the view rather than saying "this view", says plainly that the
 * records are untouched, and warns separately when the view is SHARED, because
 * that deletion takes it from everyone rather than from one person.
 */
import { useDataViewsCopy } from "./data-views-copy-context";
import { Dialog, DialogContent } from "../../feedback/Dialog";
import { Button } from "../../form/Button";
import { Stack } from "../../../mui/Stack";
import { Text } from "../../typography/Text";

import type { SavedViewSummary } from "./data-views-types";

export function DeleteViewDialog({
  view,
  onClose,
  onConfirm,
  /** What this table holds, for the "your records are safe" line. */
  entityLabel = "Os registros",
  testIdPrefix = "view",
}: {
  view: SavedViewSummary | null;
  onClose: () => void;
  onConfirm: (view: SavedViewSummary) => void;
  entityLabel?: string;
  testIdPrefix?: string;
}): React.JSX.Element | null {
  const copy = useDataViewsCopy();
  if (!view) return null;
  return (
    <Dialog
      open
      onClose={onClose}
      title={copy.deleteView.title}
      size="sm"
      showCloseButton
      dataTestId={`${testIdPrefix}-delete-modal`}
    >
      <DialogContent>
        <Stack spacing={1.5}>
          <Text variant="body" as="p" data-testid={`${testIdPrefix}-delete-target`}>
            Excluir <strong>{view.name}</strong>?
          </Text>

          {view.shared && (
            <Text variant="body" color="warning" as="p" data-testid={`${testIdPrefix}-delete-shared`}>
              {copy.deleteView.sharedWarning}
            </Text>
          )}

          <Text variant="body" color="secondary" as="p">
            {copy.deleteView.rowsUnaffected(entityLabel)}
          </Text>

          <Stack direction="row" spacing={1.5} sx={{ justifyContent: "flex-end", pt: 0.5 }}>
            <Button
              variant="text"
              color="neutral"
              onClick={onClose}
              dataTestId={`${testIdPrefix}-delete-cancel`}
            >
              Cancelar
            </Button>
            <Button
              color="danger"
              onClick={() => onConfirm(view)}
              dataTestId={`${testIdPrefix}-delete-confirm`}
            >
              {copy.deleteView.confirm}
            </Button>
          </Stack>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
