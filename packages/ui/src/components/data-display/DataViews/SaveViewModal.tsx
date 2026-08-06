"use client";

import GroupOutlinedIcon from "@mui/icons-material/GroupOutlined";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import StarOutlineRoundedIcon from "@mui/icons-material/StarOutlineRounded";
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
  return (
    <Stack spacing={0}>
      <FlagRow
        icon={<PushPinOutlinedIcon fontSize="small" />}
        title="Fixar na barra lateral"
        description="Aparece como atalho no menu, abaixo desta tela."
        checked={pinned}
        onChange={setPinned}
        testId={`${testIdPrefix}-save-pinned`}
      />
      <FlagRow
        icon={<GroupOutlinedIcon fontSize="small" />}
        title="Compartilhar com a equipe"
        description="Qualquer pessoa da loja poderá abrir e usar esta visão."
        checked={shared}
        onChange={setShared}
        testId={`${testIdPrefix}-save-shared`}
      />
      <FlagRow
        icon={<StarOutlineRoundedIcon fontSize="small" />}
        title="Definir como padrão"
        description="Esta tela abre nesta visão em vez da Visão principal."
        checked={isDefault}
        onChange={setIsDefault}
        testId={`${testIdPrefix}-save-default`}
      />
    </Stack>
  );
}

interface PreviewBoxProps {
  preview: { filters: string[]; columns: string[]; sort: string[] };
  testIdPrefix: string;
}

/** One "label — value" line of the summary. */
function SummaryRow({
  label,
  items,
  testId,
}: {
  label: string;
  items: string[];
  testId: string;
}): React.JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <Box sx={{ display: "flex", gap: 1.5 }} data-testid={testId}>
      <Text variant="caption" as="span">
        <Box component="span" sx={{ width: 116, flexShrink: 0, color: "text.secondary" }}>
          {label}
        </Box>
      </Text>
      <Text variant="caption" as="span">
        <Box component="span" sx={{ minWidth: 0, flex: 1 }}>
          {items.join(", ")}
        </Box>
      </Text>
    </Box>
  );
}

function PreviewBox({ preview, testIdPrefix }: PreviewBoxProps): React.JSX.Element {
  const empty =
    preview.filters.length === 0 && preview.columns.length === 0 && preview.sort.length === 0;
  return (
    <Box sx={{ p: 1.5, borderRadius: 1.5, bgcolor: "action.hover", border: (theme) => `1px solid ${theme.palette.divider}` }}>
      <Text variant="caption" as="p">
        <Box
          component="span"
          sx={{ display: "block", mb: 1, textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 600, color: "text.disabled" }}
        >
          O que esta visão guarda
        </Box>
      </Text>
      {empty ? (
        // Saving is still allowed — an operator may be naming the default on
        // purpose — but it should not be a surprise afterwards.
        <Text variant="caption" as="p">
          <Box component="span" sx={{ color: "warning.main", lineHeight: 1.6 }} data-testid={`${testIdPrefix}-preview-empty`}>
            Nada foi alterado — esta visão ficará igual à Visão principal.
          </Box>
        </Text>
      ) : (
        <Stack spacing={0.75}>
          <SummaryRow label="Filtros" items={preview.filters} testId={`${testIdPrefix}-preview-filters`} />
          <SummaryRow label="Colunas ocultas" items={preview.columns} testId={`${testIdPrefix}-preview-columns`} />
          <SummaryRow label="Ordenação" items={preview.sort} testId={`${testIdPrefix}-preview-sort`} />
        </Stack>
      )}
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
            placeholder="Ex.: Recusados no PIX desta semana"
            value={form.name}
            onChange={(event) => form.setName(event.target.value)}
            data-testid={`${testIdPrefix}-save-name`}
          />
          <Input
            size="sm"
            fullWidth
            label="Descrição — opcional"
            placeholder="Para que serve esta visão"
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

          {/* Cancel first, primary last: the confirming action sits where the
              eye lands at the end of the dialog, not before the way out. */}
          <Stack direction="row" spacing={1.5} sx={{ justifyContent: "flex-end" }}>
            <Button variant="text" color="neutral" onClick={onClose} dataTestId={`${testIdPrefix}-save-cancel`}>
              Cancelar
            </Button>
            <Button
              onClick={() => void form.submit()}
              disabled={!form.canSave}
              dataTestId={`${testIdPrefix}-save-submit`}
            >
              {editing ? "Salvar alterações" : "Salvar visão"}
            </Button>
          </Stack>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
