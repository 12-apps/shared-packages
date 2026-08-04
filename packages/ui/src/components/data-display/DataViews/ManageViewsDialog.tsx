"use client";

import { ConfirmButton } from "../../feedback/ConfirmAction";
import { Dialog, DialogContent } from "../../feedback/Dialog";
import { Button } from "../../form/Button";
import { Box } from "../../../mui/Box";
import { Stack } from "../../../mui/Stack";
import { Text } from "../../typography/Text";

import type { SavedViewSummary } from "./data-views-types";

interface ManageViewsDialogProps {
  open: boolean;
  onClose: () => void;
  views: SavedViewSummary[];
  onEdit: (view: SavedViewSummary) => void;
  onDelete: (view: SavedViewSummary) => void;
  testIdPrefix?: string;
}

function tags(view: SavedViewSummary): string[] {
  const list: string[] = [];
  if (view.isDefault) list.push("Padrão");
  if (view.pinned) list.push("Fixada");
  if (view.shared) list.push("Compartilhada");
  if (!view.isOwner) list.push("De outro usuário");
  return list;
}

/**
 * "Gerenciar visões" dialog (FUT-89): lists every view the user can see with its
 * flags, and owner-only edit/delete. Non-owned shared views are listed read-only.
 */
/** One saved view: its name/description/tags, and the owner-only actions. */
function ManageViewRow({
  view,
  onEdit,
  onDelete,
  testIdPrefix,
}: {
  view: SavedViewSummary;
  onEdit: (view: SavedViewSummary) => void;
  onDelete: (view: SavedViewSummary) => void;
  testIdPrefix: string;
}): React.JSX.Element {
  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{ alignItems: "center", justifyContent: "space-between" }}
      data-testid={`${testIdPrefix}-manage-row-${view.id}`}
    >
      <Box sx={{ minWidth: 0 }}>
        <Text variant="body" size="sm" as="span" weight="semibold">
          {view.name}
        </Text>
        {view.description && (
          <Text variant="caption" as="p" color="secondary">
            {view.description}
          </Text>
        )}
        {tags(view).length > 0 && (
          <Text variant="caption" as="p" color="secondary">
            {tags(view).join(" · ")}
          </Text>
        )}
      </Box>
      {view.isOwner && (
        <Stack direction="row" spacing={1} sx={{ flex: "0 0 auto" }}>
          <Button
            variant="text"
            size="sm"
            onClick={() => onEdit(view)}
            dataTestId={`${testIdPrefix}-manage-edit-${view.id}`}
          >
            Editar
          </Button>
          {/* Confirm-gated (FUT-546): a saved view is a filter set somebody
              built by hand, and there is no undo behind this. */}
          <ConfirmButton
            variant="text"
            size="sm"
            color="danger"
            onClick={() => onDelete(view)}
            confirm={{
              title: 'Excluir a visão salva?',
              entityName: view.name,
              description:
                'Os filtros e colunas guardados nela são perdidos. Não é possível restaurar.',
              confirmText: 'Excluir',
            }}
            dataTestId={`${testIdPrefix}-manage-delete-${view.id}`}
          >
            Excluir
          </ConfirmButton>
        </Stack>
      )}
    </Stack>
  );
}

export function ManageViewsDialog({
  open,
  onClose,
  views,
  onEdit,
  onDelete,
  testIdPrefix = "views",
}: ManageViewsDialogProps): React.JSX.Element {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Gerenciar visões"
      size="md"
      showCloseButton
      dataTestId={`${testIdPrefix}-manage-dialog`}
    >
      <DialogContent>
        <Stack spacing={1.5} data-testid={`${testIdPrefix}-manage-list`}>
          {views.length === 0 ? (
            <Text variant="body" as="p">
              Nenhuma visão salva.
            </Text>
          ) : (
            views.map((view) => (
              <ManageViewRow
                key={view.id}
                view={view}
                onEdit={onEdit}
                onDelete={onDelete}
                testIdPrefix={testIdPrefix}
              />
            ))
          )}
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
