"use client";

import { useDataViewsCopy } from "./data-views-copy-context";
import { Alert } from "../Alert";
import { SavedViewsMenu } from "../../layout/ContentToolbar";

import {
  type DataViewColumn,
  type DataViewState,
  type FilterFieldConfig,
  type SavedViewSummary,
} from "./data-views-types";
import { ManageViewsDialog } from "./ManageViewsDialog";
import { SaveViewModal, type SaveViewPayload } from "./SaveViewModal";

/**
 * A rejected pin/share/default/delete surfaced inline (FUT-100) — the menus
 * close on click, so this Alert is the only signal that survives the action.
 */
export function ViewMutationErrorAlert({
  error,
  onClose,
  testIdPrefix,
}: {
  error: string | null;
  onClose: () => void;
  testIdPrefix: string;
}): React.JSX.Element | null {
  const copy = useDataViewsCopy();
  if (!error) {
    return null;
  }
  return (
    <Alert
      variant="danger"
      title={copy.nav.updateFailed}
      description={error}
      closable
      onClose={onClose}
      data-testid={`${testIdPrefix}-views-mutation-error`}
    />
  );
}

interface ViewsMenuSlotProps {
  views: SavedViewSummary[];
  /** Name of the currently-applied view, shown in the trigger instead of "Visões". */
  activeViewName?: string;
  applyView: (view: SavedViewSummary) => void;
  /** Reset to the built-in no-filter "Main vision" default. */
  selectMain: () => void;
  openCreate: () => void;
  openEdit: (view: SavedViewSummary) => void;
  handleDelete: (view: SavedViewSummary) => void;
  patchView: (
    view: SavedViewSummary,
    changes: Partial<Pick<SavedViewSummary, "isDefault" | "pinned" | "shared">>,
  ) => Promise<void>;
  onManageAll: () => void;
  testIdPrefix: string;
}

/**
 * The saved-views Connector (FUT-89): binds the backend-backed SavedView state +
 * mutations to the stateless `@12-apps/ui` SavedViewsMenu. All persistence lives here
 * (via the passed handlers); the UI component itself stays data-free.
 */
export function ViewsMenuSlot({
  views,
  activeViewName,
  applyView,
  selectMain,
  openCreate,
  openEdit,
  handleDelete,
  patchView,
  onManageAll,
  testIdPrefix,
}: ViewsMenuSlotProps): React.JSX.Element {
  const copy = useDataViewsCopy();
  return (
    <SavedViewsMenu<SavedViewSummary>
      labels={copy.savedViewsMenu}
      views={views}
      activeViewName={activeViewName}
      onApply={applyView}
      onSelectMain={selectMain}
      onSaveCurrent={openCreate}
      onEdit={openEdit}
      onDelete={(view) => void handleDelete(view)}
      onSetDefault={(view) => void patchView(view, { isDefault: true })}
      onTogglePin={(view) => void patchView(view, { pinned: !view.pinned })}
      onToggleShare={(view) => void patchView(view, { shared: !view.shared })}
      onManageAll={onManageAll}
      testIdPrefix={`${testIdPrefix}-views`}
    />
  );
}

interface ViewDialogsProps<T extends Record<string, unknown>> {
  saveOpen: boolean;
  onCloseSave: () => void;
  currentState: DataViewState;
  fields: FilterFieldConfig<T>[];
  columns: DataViewColumn<T>[];
  editing: SavedViewSummary | null;
  onSave: (payload: SaveViewPayload) => Promise<void>;
  manageOpen: boolean;
  onCloseManage: () => void;
  views: SavedViewSummary[];
  onEditFromManage: (view: SavedViewSummary) => void;
  onDelete: (view: SavedViewSummary) => void;
  testIdPrefix: string;
}

/** The save-view modal + the manage-views dialog (FUT-89). */
export function ViewDialogs<T extends Record<string, unknown>>({
  saveOpen,
  onCloseSave,
  currentState,
  fields,
  columns,
  editing,
  onSave,
  manageOpen,
  onCloseManage,
  views,
  onEditFromManage,
  onDelete,
  testIdPrefix,
}: ViewDialogsProps<T>): React.JSX.Element {
  const copy = useDataViewsCopy();
  return (
    <>
      {/* Keyed by the view being edited: the form seeds its fields with
          `useState`, which only runs on MOUNT, so a modal that stayed mounted
          from a previous open reused those values — "Renomear e editar" opened
          with an empty Nome once "Salvar visão" had been opened first. */}
      <SaveViewModal<T>
        key={editing ? `edit-${editing.id}` : "create"}
        open={saveOpen}
        onClose={onCloseSave}
        currentState={currentState}
        fields={fields}
        columns={columns}
        editing={editing}
        onSave={onSave}
        testIdPrefix={`${testIdPrefix}-views`}
      />
      <ManageViewsDialog confirmCopy={copy.confirmAction}
        open={manageOpen}
        onClose={onCloseManage}
        views={views}
        onEdit={onEditFromManage}
        onDelete={onDelete}
        testIdPrefix={`${testIdPrefix}-views`}
      />
    </>
  );
}
