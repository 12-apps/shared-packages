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
 *
 * The way OUT is no longer on this row. It is the breadcrumb trail above it —
 * see `report-breadcrumbs`, which is where the guard now hangs too.
 */
import type { JSX } from "react";

import { Button } from "@12-apps/ui/form/Button";
import { Input } from "@12-apps/ui/form/Input";
import { Box } from "@12-apps/ui/mui/Box";
import { Stack } from "@12-apps/ui/mui/Stack";
import { Text } from "@12-apps/ui/typography/Text";

import type { PublishDraft } from "./lib/publish-section";
import { ReportBreadcrumbs, type ReportCrumb } from "./lib/report-breadcrumbs";
import { ReportStatusChip } from "./lib/report-status-chip";
import { CONTROL_ROW_SX } from "./lib/report-surface";
import type { AutosaveState } from "./lib/use-autosave";
import type { ReportEditorCopy, ReportScreensCopy } from "./screens-copy";
import { useReportCopy } from "./transport-context";

/** Who can see it, in the words the subtitle uses. */


/**
 * "0 blocos · só você" — derived, never written down.
 *
 * Both halves change while the editor is open (a block is added, the sharing
 * rule is switched in Ajustes), so a hardcoded line would be wrong within
 * seconds. The singular is the case a naive `${n} blocos` gets wrong, and it
 * is also the most common one — every report passes through exactly one block.
 */
export function editorSubtitle(
  blockCount: number,
  publish: PublishDraft,
  copy: ReportScreensCopy,
): string {
  return copy.editor.subtitle(
    copy.list.blockCount(blockCount),
    copy.editor.visibilityWords[publish.visibility] ?? "",
  );
}

/**
 * The name's own left padding, and the negative margin that cancels it.
 *
 * `prototype.html`'s `.title-input` carries exactly this pair
 * (`padding:3px 8px; margin-left:-8px`) and it is the whole alignment trick:
 * an editable title needs inner padding so its hover and focus states are a
 * box around the words rather than a box touching them, and that padding
 * indents the words away from the subtitle sitting underneath. Cancelling it
 * on the outside puts the first glyph of the NAME and the first glyph of the
 * SUBTITLE on the same vertical line — which is what "the header is not well
 * aligned" was pointing at.
 */
const NAME_PAD_X = "8px";

/** The name, edited where it is read — the page's only naming control. */
const NAME_INPUT_SX = {
  // On the FIELD, not on the wrapper: the wrapper is the flex item the row
  // sizes, and pulling that left moves the whole column rather than just the
  // words in it.
  "& .MuiOutlinedInput-root": { bgcolor: "transparent", ml: `-${NAME_PAD_X}` },
  '& .MuiOutlinedInput-notchedOutline': { borderColor: "transparent" },
  "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: "divider" },
  "& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline": {
    borderColor: "primary.main",
  },
  "& .MuiInputBase-input": {
    fontSize: "1.125rem",
    fontWeight: 600,
    px: NAME_PAD_X,
    py: "3px",
  },
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
  const copy = useReportCopy().screens.editor;
  return (
    <Stack spacing={0.25} sx={{ flex: 1, minWidth: 180 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
        <Box sx={{ flex: 1, minWidth: 140, ...NAME_INPUT_SX }}>
          <Input
            aria-label={copy.nameLabel}
            placeholder={copy.namePlaceholder}
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            data-testid="report-editor-name"
          />
        </Box>
        {/* The SAME pill the view screen shows — see `report-status-chip` for
            why one report's one status was rendering two different ways. */}
        <ReportStatusChip status={status} dataTestId="report-editor-status-chip" />
      </Stack>
      <Text variant="body" size="xs" color="secondary" data-testid="report-editor-subtitle">
        {subtitle}
      </Text>
    </Stack>
  );
}

/**
 * What autosave is doing, in the two states a person must not have to guess at
 * (FUT-755).
 *
 * SUCCESS is deliberately silent: a save the server accepted moves the
 * unsaved-changes baseline, so "Alterações não salvas" disappears on its own —
 * which IS the feedback. Saying it a second time would make a routine autosave
 * the loudest thing on the header.
 *
 * FAILURE is not silent, and it says where the work went. A failed save leaves
 * the report dirty and its tab-close guard armed (see `dirty-state`), so the
 * accurate sentence is that the changes are still here — not that something
 * broke and they are gone.
 */
function AutosaveNotice({ autosave }: { autosave: AutosaveState }): JSX.Element | null {
  const copy = useReportCopy().screens.editor;
  if (autosave !== "saving" && autosave !== "error") return null;
  const failed = autosave === "error";
  return (
    <Text
      variant="body"
      size="sm"
      color={failed ? "danger" : "secondary"}
      role="status"
      data-testid="report-editor-autosave"
    >
      {failed
        ? copy.autosaveFailed
        : copy.autosaving}
    </Text>
  );
}

/** ⚙ Ajustes · Descartar · Salvar — the cluster that may wrap to its own line. */
function HeaderActions({
  saving,
  dirty,
  autosave,
  onOpenSettings,
  onCancel,
  onSave,
}: {
  saving: boolean;
  dirty: boolean;
  autosave: AutosaveState;
  onOpenSettings: () => void;
  onCancel: () => void;
  onSave: () => void;
}): JSX.Element {
  const copy = useReportCopy().screens.editor;
  const builder = useReportCopy().screens.builder;
  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1, ...CONTROL_ROW_SX }}
    >
      <AutosaveNotice autosave={autosave} />
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
          {copy.unsavedChanges}
        </Text>
      ) : null}
      <Button
        variant="ghost"
        color="neutral"
        size="sm"
        onClick={onOpenSettings}
        dataTestId="report-editor-settings"
      >
        {copy.settings}
      </Button>
      <Button variant="outline" size="sm" onClick={onCancel} dataTestId="report-editor-cancel">
        {builder.discard}
      </Button>
      <Button
        variant="solid"
        size="sm"
        onClick={onSave}
        disabled={saving}
        dataTestId="report-editor-save"
      >
        {saving ? copy.saving : copy.save}
      </Button>
    </Stack>
  );
}

/**
 * The way out of the editor — every level above it, as a trail.
 *
 * `report-editor-back` rides on the crumb that goes where the old
 * `← Sair da edição` link went: the saved report, or the list when there is no
 * saved report yet. The id names an INTENT ("leave the editor"), and that
 * intent has the same destination it always had, so the e2e that drives it
 * does not need to know the trail grew.
 *
 * Every clickable crumb is guarded, not just that one — see `onBeforeExit`.
 * Leaving for the LIST costs exactly what leaving for the report costs, and a
 * guard that covered only one of the two exits would be a prompt you could
 * walk around. It is still not a general route guard: blocking arbitrary
 * in-app navigation needs react-router's blocker, which requires a data
 * router, and this surface mounts under whatever router its host has. The
 * `beforeunload` guard in `use-unsaved-changes` covers closing the tab, so
 * between them every exit this package can see is covered.
 */
function editorCrumbs(
  tenantSlug: string,
  name: string,
  copy: ReportEditorCopy,
  editId?: string,
): ReportCrumb[] {
  const list: ReportCrumb = {
    label: copy.breadcrumbList,
    href: `/${tenantSlug}/reports`,
    ...(editId ? {} : { dataTestId: "report-editor-back" }),
  };
  // The name is being typed as this renders, so an empty one is a real state
  // and needs the same placeholder the input shows.
  const reportLabel = name.trim() || copy.namePlaceholder;
  if (!editId) return [list, { label: reportLabel }];
  return [
    list,
    {
      label: reportLabel,
      href: `/${tenantSlug}/reports/${editId}`,
      dataTestId: "report-editor-back",
    },
    { label: copy.breadcrumbEditing },
  ];
}

export function ReportEditorHeader({
  tenantSlug,
  editId,
  name,
  publish,
  blockCount,
  saving,
  dirty,
  autosave = "idle",
  onNameChange,
  onOpenSettings,
  onCancel,
  onSave,
  onBeforeExit,
}: {
  tenantSlug: string;
  /** Absent on a new report — there is no saved report to go back to. */
  editId?: string;
  name: string;
  publish: PublishDraft;
  blockCount: number;
  saving: boolean;
  dirty: boolean;
  /** Autosave's state (FUT-755); defaults to idle, which renders nothing. */
  autosave?: AutosaveState;
  onNameChange: (name: string) => void;
  onOpenSettings: () => void;
  onCancel: () => void;
  onSave: () => void;
  /**
   * Asked before leaving, with the href being left for. Return `false` to
   * cancel the navigation — the caller then owns saying why, and owns
   * resuming it to the href it was handed. Omitted, leaving is never
   * interrupted, which is what a host with nothing to warn about should get
   * for free.
   */
  onBeforeExit?: (href: string) => boolean;
}): JSX.Element {
  const screens = useReportCopy().screens;
  return (
    <Stack spacing={1}>
      <ReportBreadcrumbs
        crumbs={editorCrumbs(tenantSlug, name, screens.editor, editId)}
        dataTestId="report-editor-crumbs"
        {...(onBeforeExit ? { onBeforeNavigate: onBeforeExit } : {})}
      />
      <Stack
        direction="row"
        spacing={1.5}
        sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}
        data-testid="report-editor-header"
      >
        <NameAndStatus
          name={name}
          status={publish.status}
          subtitle={editorSubtitle(blockCount, publish, screens)}
          onNameChange={onNameChange}
        />
        <HeaderActions
          saving={saving}
          dirty={dirty}
          autosave={autosave}
          onOpenSettings={onOpenSettings}
          onCancel={onCancel}
          onSave={onSave}
        />
      </Stack>
    </Stack>
  );
}
