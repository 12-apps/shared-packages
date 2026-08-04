"use client";

import { useState } from "react";

import { Dialog, DialogContent } from "../../feedback/Dialog";
import { Button } from "../../form/Button";
import { Input } from "../../form/Input";
import { Switch } from "../../form/Switch";
import { Box } from "../../../mui/Box";
import { Stack } from "../../../mui/Stack";
import { Text } from "../../typography/Text";

import { describeViewState } from "./data-views-preview";
import type {
  DataViewColumn,
  DataViewState,
  FilterFieldConfig,
  SavedViewSummary,
} from "./data-views-types";

/** The values the modal collects (the current view state is captured by the parent). */
export interface SaveViewPayload {
  name: string;
  description: string;
  shared: boolean;
  pinned: boolean;
  isDefault: boolean;
}

interface SaveViewModalProps<T extends Record<string, unknown>> {
  open: boolean;
  onClose: () => void;
  /** The state being saved (drives the preview). */
  currentState: DataViewState;
  fields: FilterFieldConfig<T>[];
  columns: DataViewColumn<T>[];
  /** When set, the modal edits this view (seeds the form + becomes "Salvar alterações"). */
  editing?: SavedViewSummary | null;
  onSave: (payload: SaveViewPayload) => Promise<void> | void;
  testIdPrefix?: string;
}

function PreviewList({ title, items, testId }: { title: string; items: string[]; testId: string }): React.JSX.Element {
  return (
    <Box data-testid={testId}>
      <Text variant="caption" as="span" weight="semibold">
        {title}
      </Text>
      {items.length === 0 ? (
        <Text variant="caption" as="p" color="secondary">
          —
        </Text>
      ) : (
        <Stack component="ul" spacing={0.25} sx={{ m: 0, pl: 2 }}>
          {items.map((item) => (
            <Text key={item} variant="caption" as="li">
              {item}
            </Text>
          ))}
        </Stack>
      )}
    </Box>
  );
}

interface FlagsSwitchesProps {
  pinned: boolean;
  shared: boolean;
  isDefault: boolean;
  setPinned: (value: boolean) => void;
  setShared: (value: boolean) => void;
  setIsDefault: (value: boolean) => void;
  testIdPrefix: string;
}

function FlagsSwitches({
  pinned,
  shared,
  isDefault,
  setPinned,
  setShared,
  setIsDefault,
  testIdPrefix,
}: FlagsSwitchesProps): React.JSX.Element {
  return (
    <Stack spacing={0.5}>
      <Switch
        size="sm"
        label="Fixar na barra lateral"
        checked={pinned}
        onChange={(_event, value) => setPinned(value)}
        dataTestId={`${testIdPrefix}-save-pinned`}
      />
      <Switch
        size="sm"
        label="Compartilhar com a equipe"
        checked={shared}
        onChange={(_event, value) => setShared(value)}
        dataTestId={`${testIdPrefix}-save-shared`}
      />
      <Switch
        size="sm"
        label="Definir como padrão"
        checked={isDefault}
        onChange={(_event, value) => setIsDefault(value)}
        dataTestId={`${testIdPrefix}-save-default`}
      />
    </Stack>
  );
}

interface PreviewBoxProps {
  preview: { filters: string[]; columns: string[]; sort: string[] };
  testIdPrefix: string;
}

function PreviewBox({ preview, testIdPrefix }: PreviewBoxProps): React.JSX.Element {
  return (
    <Box sx={{ p: 1.5, borderRadius: 1, border: (theme) => `1px solid ${theme.palette.divider}` }}>
      <Text variant="caption" as="p" weight="semibold">
        Prévia
      </Text>
      <Stack spacing={1} sx={{ mt: 0.5 }}>
        <PreviewList title="Filtros" items={preview.filters} testId={`${testIdPrefix}-preview-filters`} />
        <PreviewList title="Colunas" items={preview.columns} testId={`${testIdPrefix}-preview-columns`} />
        <PreviewList title="Ordenação" items={preview.sort} testId={`${testIdPrefix}-preview-sort`} />
      </Stack>
    </Box>
  );
}

interface SaveViewFormState {
  name: string;
  description: string;
  pinned: boolean;
  shared: boolean;
  isDefault: boolean;
  canSave: boolean;
  error: string | null;
  setName: (value: string) => void;
  setDescription: (value: string) => void;
  setPinned: (value: boolean) => void;
  setShared: (value: boolean) => void;
  setIsDefault: (value: boolean) => void;
  submit: () => Promise<void>;
}

/** The initial form values, seeded from an edited view (or blank for create). */
function seedForm(editing: SavedViewSummary | null | undefined): SaveViewPayload {
  if (!editing) {
    return { name: "", description: "", pinned: false, shared: false, isDefault: false };
  }
  return {
    name: editing.name,
    description: editing.description ?? "",
    pinned: editing.pinned,
    shared: editing.shared,
    isDefault: editing.isDefault,
  };
}

/** Local form state + submit for {@link SaveViewModal}, seeded from an edited view. */
function useSaveViewForm(
  editing: SavedViewSummary | null | undefined,
  onSave: (payload: SaveViewPayload) => Promise<void> | void,
): SaveViewFormState {
  const initial = seedForm(editing);
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [pinned, setPinned] = useState(initial.pinned);
  const [shared, setShared] = useState(initial.shared);
  const [isDefault, setIsDefault] = useState(initial.isDefault);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = name.trim().length > 0 && !saving;

  async function submit(): Promise<void> {
    setSaving(true);
    setError(null);
    // A rejected save (e.g. duplicate name) is caught here so the modal stays
    // open and shows the reason; the finally always re-enables the button.
    try {
      await onSave({ name: name.trim(), description: description.trim(), shared, pinned, isDefault });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar a visão.");
    } finally {
      setSaving(false);
    }
  }

  return {
    name,
    description,
    pinned,
    shared,
    isDefault,
    canSave,
    error,
    setName,
    setDescription,
    setPinned,
    setShared,
    setIsDefault,
    submit,
  };
}

/**
 * The "Salvar visão" modal (FUT-89): captures a name + description and the pin /
 * share / default flags, and previews the filters, visible columns, and sort the
 * view will store. Used for both create and edit.
 */
export function SaveViewModal<T extends Record<string, unknown>>({
  open,
  onClose,
  currentState,
  fields,
  columns,
  editing,
  onSave,
  testIdPrefix = "view",
}: SaveViewModalProps<T>): React.JSX.Element {
  const form = useSaveViewForm(editing, onSave);
  const preview = describeViewState(currentState, fields, columns);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? "Editar visão" : "Salvar visão"}
      size="sm"
      showCloseButton
      dataTestId={`${testIdPrefix}-save-modal`}
    >
      <DialogContent>
        <Stack spacing={2} data-testid={`${testIdPrefix}-save-form`}>
          <Input
            size="sm"
            fullWidth
            label="Nome"
            value={form.name}
            onChange={(event) => form.setName(event.target.value)}
            data-testid={`${testIdPrefix}-save-name`}
          />
          <Input
            size="sm"
            fullWidth
            label="Descrição (opcional)"
            value={form.description}
            onChange={(event) => form.setDescription(event.target.value)}
            data-testid={`${testIdPrefix}-save-description`}
          />

          <FlagsSwitches
            pinned={form.pinned}
            shared={form.shared}
            isDefault={form.isDefault}
            setPinned={form.setPinned}
            setShared={form.setShared}
            setIsDefault={form.setIsDefault}
            testIdPrefix={testIdPrefix}
          />

          <PreviewBox preview={preview} testIdPrefix={testIdPrefix} />

          {form.error && (
            <Text variant="caption" color="danger" as="p" data-testid={`${testIdPrefix}-save-error`}>
              {form.error}
            </Text>
          )}

          <Stack direction="row" spacing={2}>
            <Button
              onClick={() => void form.submit()}
              disabled={!form.canSave}
              dataTestId={`${testIdPrefix}-save-submit`}
            >
              {editing ? "Salvar alterações" : "Salvar visão"}
            </Button>
            <Button variant="text" onClick={onClose} dataTestId={`${testIdPrefix}-save-cancel`}>
              Cancelar
            </Button>
          </Stack>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
