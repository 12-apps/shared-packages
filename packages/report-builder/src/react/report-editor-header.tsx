/**
 * The editor's header (GAP 8) — ONE line, and the report's identity on it.
 *
 * What it replaces: a back link, an h1, a paragraph of explanation and then
 * four stacked form controls (Nome, Descrição, Status, Quem pode ver) before
 * the canvas began. Composing a report started as filling in a form, and the
 * thing being composed was below the fold.
 *
 * `prototype.html`'s edit bar instead carries the report: the NAME is edited
 * in place, a chip says whether it is a draft, a small line under it says how
 * big it is and who can see it, and everything else moves behind ⚙ Ajustes.
 *
 * The row WRAPS rather than scrolls. This area has shipped a header that
 * overflowed at 390px and pushed its only edit affordance off-screen; the
 * name is allowed to shrink (`minWidth: 0`) and the action cluster is allowed
 * to fall to a second line, so the narrow tier loses layout, never controls.
 */
import type { JSX } from "react";
import { Link } from "react-router-dom";

import { Chip } from "@12-apps/ui/data-display/Chip";
import { Button } from "@12-apps/ui/form/Button";
import { Input } from "@12-apps/ui/form/Input";
import { Box } from "@12-apps/ui/mui/Box";
import { Stack } from "@12-apps/ui/mui/Stack";
import { Text } from "@12-apps/ui/typography/Text";

import type { PublishDraft } from "./lib/publish-section";
import { CONTROL_ROW_SX } from "./lib/report-surface";

/** Who can see it, in the words the subtitle uses. */
const VISIBILITY_WORDS: Record<PublishDraft["visibility"], string> = {
  private: "só você",
  tenant: "toda a equipe",
  roles: "cargos específicos",
};

/**
 * "0 blocos · só você" — derived, never written down.
 *
 * Both halves change while the editor is open (a block is added, the sharing
 * rule is switched in Ajustes), so a hardcoded line would be wrong within
 * seconds. The singular is the case a naive `${n} blocos` gets wrong, and it
 * is also the most common one — every report passes through exactly one block.
 */
export function editorSubtitle(blockCount: number, publish: PublishDraft): string {
  const blocks = blockCount === 1 ? "1 bloco" : `${blockCount} blocos`;
  return `${blocks} · ${VISIBILITY_WORDS[publish.visibility]}`;
}

/** The name, edited where it is read — the page's only naming control. */
const NAME_INPUT_SX = {
  "& .MuiOutlinedInput-root": { bgcolor: "transparent" },
  '& .MuiOutlinedInput-notchedOutline': { borderColor: "transparent" },
  "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: "divider" },
  "& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline": {
    borderColor: "primary.main",
  },
  "& .MuiInputBase-input": { fontSize: "1.125rem", fontWeight: 600 },
} as const;

function NameAndStatus({
  name,
  status,
  subtitle,
  onNameChange,
}: {
  name: string;
  status: PublishDraft["status"];
  subtitle: string;
  onNameChange: (name: string) => void;
}): JSX.Element {
  return (
    <Stack spacing={0.25} sx={{ flex: 1, minWidth: 180 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
        <Box sx={{ flex: 1, minWidth: 140, ...NAME_INPUT_SX }}>
          <Input
            aria-label="Nome do relatório"
            placeholder="Relatório sem título"
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            data-testid="report-editor-name"
          />
        </Box>
        <Chip
          size="small"
          // A draft is a WARNING-toned pill in the prototype (amber), because
          // "nobody else can see this yet" is a caveat, not a decoration.
          color={status === "draft" ? "warning" : "primary"}
          variant="filled"
          label={status === "draft" ? "Rascunho" : "Publicado"}
          dataTestId="report-editor-status-chip"
        />
      </Stack>
      <Text variant="body" size="xs" color="secondary" data-testid="report-editor-subtitle">
        {subtitle}
      </Text>
    </Stack>
  );
}

/** ⚙ Ajustes · Descartar · Salvar — the cluster that may wrap to its own line. */
function HeaderActions({
  saving,
  dirty,
  onOpenSettings,
  onCancel,
  onSave,
}: {
  saving: boolean;
  dirty: boolean;
  onOpenSettings: () => void;
  onCancel: () => void;
  onSave: () => void;
}): JSX.Element {
  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1, ...CONTROL_ROW_SX }}
    >
      {/* Announced politely: a status that only changes colour is invisible to
          a screen reader, and "unsaved" is the one state a person must not
          have to look for. */}
      {dirty ? (
        <Text
          variant="body"
          size="sm"
          color="secondary"
          role="status"
          data-testid="report-editor-dirty"
        >
          Alterações não salvas
        </Text>
      ) : null}
      <Button
        variant="ghost"
        color="neutral"
        size="sm"
        onClick={onOpenSettings}
        dataTestId="report-editor-settings"
      >
        ⚙ Ajustes
      </Button>
      <Button variant="outline" size="sm" onClick={onCancel} dataTestId="report-editor-cancel">
        Descartar
      </Button>
      <Button
        variant="solid"
        size="sm"
        onClick={onSave}
        disabled={saving}
        dataTestId="report-editor-save"
      >
        {saving ? "Salvando…" : "Salvar ⌘S"}
      </Button>
    </Stack>
  );
}

export function ReportEditorHeader({
  tenantSlug,
  editId,
  name,
  publish,
  blockCount,
  saving,
  dirty,
  onNameChange,
  onOpenSettings,
  onCancel,
  onSave,
}: {
  tenantSlug: string;
  /** Absent on a new report — there is no saved report to go back to. */
  editId?: string;
  name: string;
  publish: PublishDraft;
  blockCount: number;
  saving: boolean;
  dirty: boolean;
  onNameChange: (name: string) => void;
  onOpenSettings: () => void;
  onCancel: () => void;
  onSave: () => void;
}): JSX.Element {
  return (
    <Stack
      direction="row"
      spacing={1.5}
      sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}
      data-testid="report-editor-header"
    >
      <Link
        to={editId ? `/${tenantSlug}/reports/${editId}` : `/${tenantSlug}/reports`}
        data-testid="report-editor-back"
      >
        <Text variant="body" size="sm" color="secondary">
          ← Sair da edição
        </Text>
      </Link>
      <NameAndStatus
        name={name}
        status={publish.status}
        subtitle={editorSubtitle(blockCount, publish)}
        onNameChange={onNameChange}
      />
      <HeaderActions
        saving={saving}
        dirty={dirty}
        onOpenSettings={onOpenSettings}
        onCancel={onCancel}
        onSave={onSave}
      />
    </Stack>
  );
}
