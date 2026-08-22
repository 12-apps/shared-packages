import { useState, type JSX } from "react";

import { Button } from "@12-apps/ui/form/Button";
import { Box } from "@12-apps/ui/mui/Box";
import { Stack } from "@12-apps/ui/mui/Stack";
import { useTheme } from "@12-apps/ui/mui/styles";
import { Text } from "@12-apps/ui/typography/Text";

import { ConfirmDialog } from "./lib/confirm-dialog";
import { CONTAINER_RADIUS_PX, CONTROL_ROW_SX, stateChipSx } from "./lib/report-surface";
import type { UnpublishedChanges } from "./report-editor-state";
import { useReportCopy } from "./transport-context";

/**
 * "Este relatório tem alterações não publicadas" — the strip the editor shows
 * when a PUBLISHED report is carrying an edit its readers have not been shown
 * (FUT-755).
 *
 * Its whole job is to keep two states from blurring. A report with
 * `status: 'draft'` has never been published and the header already says
 * `Rascunho`; THIS report is live — someone is reading it right now — and what
 * is unpublished is the edit, not the report. So the strip never uses the word
 * "rascunho", and it names the consequence explicitly: readers are still on the
 * published version.
 *
 * It carries the destructive half of the choice. Publishing is `Salvar`, which
 * is one control away in the header and already means "make this live"; a
 * second button doing the identical thing on the same screen would be two
 * answers to one question. Discarding has no other home, and it is the action
 * that throws work away, so it is the one that lives here — behind the same
 * confirmation `lib/confirm-dialog` gives every other destructive move in this
 * area.
 */
export function UnpublishedChangesBar({
  unpublished,
}: {
  unpublished: UnpublishedChanges;
}): JSX.Element | null {
  const theme = useTheme();
  const copy = useReportCopy().screens.editor;
  const [confirming, setConfirming] = useState(false);
  if (!unpublished.present) return null;

  return (
    <Box
      // Same amber the `Rascunho` chip is tinted with, through the same mixer,
      // so an "unpublished" state reads as one family across the area instead
      // of introducing a fourth colour treatment (`visual-pass.md` §Components).
      sx={{
        ...stateChipSx(theme.palette.warning.main, theme.palette.background.paper),
        borderRadius: `${CONTAINER_RADIUS_PX}px`,
        px: 2,
        py: 1.5,
      }}
      data-testid="report-editor-unpublished"
    >
      <Stack
        direction="row"
        spacing={2}
        sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1, ...CONTROL_ROW_SX }}
      >
        <Stack spacing={0.25} sx={{ flex: 1, minWidth: 200 }}>
          {/* `role="status"` for the same reason the header's dirty flag has
              one: a state that only changes colour is invisible to a screen
              reader, and this one says who can see what. */}
          <Text variant="body" size="sm" weight="semibold" role="status">
            {copy.unpublishedTitle}
          </Text>
          <Text variant="body" size="xs">
            {copy.unpublishedBody}
          </Text>
        </Stack>
        <Button
          variant="outline"
          size="sm"
          disabled={unpublished.discarding}
          onClick={() => setConfirming(true)}
          dataTestId="report-editor-discard-changes"
        >
          {unpublished.discarding ? copy.discarding : copy.discard}
        </Button>
      </Stack>

      <ConfirmDialog
        open={confirming}
        destructive
        title={copy.discardTitle}
        description={copy.discardBody}
        confirmText={copy.discardConfirm}
        onConfirm={() => {
          setConfirming(false);
          unpublished.discard();
        }}
        onCancel={() => setConfirming(false)}
        dataTestId="report-editor-discard-changes-confirm"
      />
    </Box>
  );
}
