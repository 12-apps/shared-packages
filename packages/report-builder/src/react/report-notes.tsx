/**
 * A built-in's notes under its rendering (FUT-4063): muted sentences, each
 * with at most one action, drawn as an OUTLINE button from the left — the
 * secondary rank, never a coloured link standing in for one.
 */
import type { JSX } from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "@12-apps/ui/form/Button";
import { Stack } from "@12-apps/ui/mui/Stack";
import { useTheme } from "@12-apps/ui/mui/styles";
import { useMediaQuery } from "@12-apps/ui/mui/useMediaQuery";
import { Text } from "@12-apps/ui/typography/Text";

import { blockNotes, notesBelowCard, noteText } from "./lib/report-notes";
import { ReportRenderView } from "./report-render";
import type { ReportNoteView, ReportRender } from "./reports-api";
import { useReportCopy } from "./transport-context";

/** Whether the screen is below `md`, where a note may move under its card (FUT-4063). */
function useNarrow(): boolean {
  const theme = useTheme();
  return useMediaQuery(theme.breakpoints.down("md"), { noSsr: true });
}

export function ReportNotes({
  notes,
  tenantSlug,
  dataTestId,
  only,
}: {
  notes: readonly ReportNoteView[] | undefined;
  tenantSlug: string;
  dataTestId: string;
  /** Draw exactly these notes (the ones below a card), instead of the block's own. */
  only?: readonly ReportNoteView[];
}): JSX.Element | null {
  const copy = useReportCopy().screens.system;
  const navigate = useNavigate();
  const narrow = useNarrow();
  const shown = only ? [...only] : blockNotes(notes, narrow);
  if (shown.length === 0) return null;
  return (
    <Stack spacing={1.5} data-testid={`${dataTestId}-notes`}>
      {shown.map((note) => (
        <Stack key={note.key} spacing={1} sx={{ alignItems: "flex-start" }} data-testid={`${dataTestId}-note-${note.key}`}>
          <Text variant="body" size="xs" color="secondary">
            {noteText(note, copy)}
          </Text>
          {note.action ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void navigate(`/${tenantSlug}/${note.action?.href ?? ""}`);
              }}
              data-testid={`${dataTestId}-note-${note.key}-action`}
            >
              {note.action.label}
            </Button>
          ) : null}
        </Stack>
      ))}
    </Stack>
  );
}

/**
 * A built-in's rendering with its notes under it — what the single-report page
 * and every dashboard block draw, so the two cannot place the notes apart. The
 * notes' test ids follow the rendering's: `<dataTestId>-notes`.
 */
export function ReportBodyWithNotes({
  report,
  tenantSlug,
  title,
  dataTestId = "report-render",
  ...view
}: Omit<Parameters<typeof ReportRenderView>[0], "render" | "notes" | "caption"> & {
  report: { render: ReportRender; notes?: readonly ReportNoteView[] };
  tenantSlug: string;
  title: string;
}): JSX.Element {
  return (
    <Stack spacing={1.5}>
      <ReportRenderView {...view} dataTestId={dataTestId} render={report.render} notes={report.notes} caption={title} />
      <ReportNotes notes={report.notes} tenantSlug={tenantSlug} dataTestId={dataTestId} />
    </Stack>
  );
}

/**
 * The notes a block draws UNDER its card on the phone (FUT-4063) — "1 turno
 * fechado automaticamente (sáb, Marcos)." sits outside the list it qualifies,
 * as the prototype draws it. Nothing above `md`, where they stay inside.
 */
export function NotesBelowCard({
  notes,
  tenantSlug,
  dataTestId,
}: {
  notes: readonly ReportNoteView[] | undefined;
  tenantSlug: string;
  dataTestId: string;
}): JSX.Element | null {
  const below = notesBelowCard(notes, useNarrow());
  if (below.length === 0) return null;
  return <ReportNotes notes={notes} only={below} tenantSlug={tenantSlug} dataTestId={`${dataTestId}-below`} />;
}
