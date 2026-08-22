"use client";

import GroupOutlinedIcon from "@mui/icons-material/GroupOutlined";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import StarOutlineRoundedIcon from "@mui/icons-material/StarOutlineRounded";
import { useState } from "react";

import { useDataViewsCopy } from "./data-views-copy-context";
import { Dialog, DialogContent } from "../../feedback/Dialog";
import { Button } from "../../form/Button";
import { Input } from "../../form/Input";
import { Switch } from "../../form/Switch";
import { Box } from "../../../mui/Box";
import { Stack } from "../../../mui/Stack";
import { Text } from "../../typography/Text";

import { describeViewState } from "./data-views-preview";
import { PreviewBox } from "./save-view-preview";
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

interface FlagsSwitchesProps {
  pinned: boolean;
  shared: boolean;
  isDefault: boolean;
  setPinned: (value: boolean) => void;
  setShared: (value: boolean) => void;
  setIsDefault: (value: boolean) => void;
  testIdPrefix: string;
}

/**
 * One flag: what it is, and what it DOES. A bare "Fixar na barra lateral"
 * beside a switch asks the operator to guess where it appears and to whom —
 * the sentence is the difference between a labelled toggle and an explained one.
 */
function FlagRow({
  icon,
  title,
  description,
  checked,
  onChange,
  testId,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  testId: string;
}): React.JSX.Element {
  return (
    <Box
      component="label"
      sx={{
        display: "flex",
        alignItems: "flex-start",
        gap: 1.5,
        px: 1,
        py: 1,
        borderRadius: 1,
        cursor: "pointer",
        "&:hover": { bgcolor: "action.hover" },
      }}
    >
      <Box sx={{ mt: 0.25, color: "text.disabled", display: "flex" }}>{icon}</Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Text variant="body" as="span">
          <Box component="span" sx={{ display: "block", fontSize: "0.875rem" }}>
            {title}
          </Box>
        </Text>
        <Text variant="caption" as="span">
          <Box component="span" sx={{ display: "block", color: "text.secondary", lineHeight: 1.5 }}>
            {description}
          </Box>
        </Text>
      </Box>
      <Switch
        size="sm"
        checked={checked}
        onChange={(_event, value) => onChange(value)}
        dataTestId={testId}
      />
    </Box>
  );
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
  const copy = useDataViewsCopy();
  return (
    <Stack spacing={0}>
      <FlagRow
        icon={<PushPinOutlinedIcon fontSize="small" />}
        title={copy.saveView.pinnedTitle}
        description={copy.saveView.pinnedDescription}
        checked={pinned}
        onChange={setPinned}
        testId={`${testIdPrefix}-save-pinned`}
      />
      <FlagRow
        icon={<GroupOutlinedIcon fontSize="small" />}
        title={copy.saveView.sharedTitle}
        description={copy.saveView.sharedDescription}
        checked={shared}
        onChange={setShared}
        testId={`${testIdPrefix}-save-shared`}
      />
      <FlagRow
        icon={<StarOutlineRoundedIcon fontSize="small" />}
        title={copy.saveView.setDefaultTitle}
        description={copy.saveView.setDefaultDescription}
        checked={isDefault}
        onChange={setIsDefault}
        testId={`${testIdPrefix}-save-default`}
      />
    </Stack>
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
  const copy = useDataViewsCopy();
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
      setError(cause instanceof Error ? cause.message : copy.saveView.saveFailed);
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
/**
 * The dialog's two buttons.
 *
 * Cancel first, primary last: the confirming action sits where the eye lands
 * at the end of the dialog, not before the way out.
 */
function FormFooter({
  editing,
  canSave,
  onSubmit,
  onClose,
  testIdPrefix,
}: {
  editing: SaveViewModalProps<never>["editing"];
  canSave: boolean;
  onSubmit: () => void;
  onClose: () => void;
  testIdPrefix: string;
}): React.JSX.Element {
  const copy = useDataViewsCopy();
  return (
    <Stack direction="row" spacing={1.5} sx={{ justifyContent: "flex-end" }}>
      <Button variant="text" color="neutral" onClick={onClose} dataTestId={`${testIdPrefix}-save-cancel`}>
        {copy.saveView.cancel}
      </Button>
      <Button onClick={onSubmit} disabled={!canSave} dataTestId={`${testIdPrefix}-save-submit`}>
        {editing ? copy.saveView.submitEditing : copy.saveView.submitCreating}
      </Button>
    </Stack>
  );
}

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
  const copy = useDataViewsCopy();
  const form = useSaveViewForm(editing, onSave);
  const preview = describeViewState(currentState, fields, columns);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? copy.saveView.titleEditing : copy.saveView.titleCreating}
      size="sm"
      showCloseButton
      dataTestId={`${testIdPrefix}-save-modal`}
    >
      <DialogContent>
        <Stack spacing={2} data-testid={`${testIdPrefix}-save-form`}>
          <Input
            size="sm"
            fullWidth
            label={copy.saveView.nameLabel}
            placeholder={copy.saveView.namePlaceholder}
            value={form.name}
            onChange={(event) => form.setName(event.target.value)}
            data-testid={`${testIdPrefix}-save-name`}
          />
          <Input
            size="sm"
            fullWidth
            label={copy.saveView.descriptionLabel}
            placeholder={copy.saveView.descriptionPlaceholder}
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

          <FormFooter
            editing={editing}
            canSave={form.canSave}
            onSubmit={() => void form.submit()}
            onClose={onClose}
            testIdPrefix={testIdPrefix}
          />
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
