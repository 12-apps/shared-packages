/**
 * A built-in's notes under its rendering (FUT-4063): muted sentences, each
 * with at most one action, drawn as an OUTLINE button from the left — the
 * secondary rank, never a coloured link standing in for one.
 */
import type { JSX } from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "@12-apps/ui/form/Button";
import { Stack } from "@12-apps/ui/mui/Stack";
import { Text } from "@12-apps/ui/typography/Text";

import { blockNotes, noteText } from "./lib/report-notes";
import type { ReportNoteView } from "./reports-api";
import { useReportCopy } from "./transport-context";

export function ReportNotes({
  notes,
  tenantSlug,
  dataTestId,
}: {
  notes: readonly ReportNoteView[] | undefined;
  tenantSlug: string;
  dataTestId: string;
}): JSX.Element | null {
  const copy = useReportCopy().screens.system;
  const navigate = useNavigate();
  const shown = blockNotes(notes);
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
