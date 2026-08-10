/**
 * The lifecycle badge beside a report's name — ONE of them, for both screens.
 *
 * It used to be two. The view screen tinted its pill through `stateChipSx`
 * (the tone mixed toward the surface, ink darkened until it is readable on
 * that mix), which is `prototype.html`'s `.chip.draft` — a pale amber ground
 * with amber-brown text. The editor rendered a plain `<Chip color="warning"
 * variant="filled">` instead, which MUI paints as SATURATED amber with white
 * text. So the same report's same status looked like two different states
 * depending on whether you were reading it or editing it, and the louder of
 * the two was the one on the busier screen.
 *
 * The design system's chip has exactly two variants — `filled` and `outlined`
 * — and neither is the soft tinted pill the prototype uses, which is why this
 * area derives one. It is derived from the THEME (`palette.warning.main` over
 * `palette.background.paper`), never from a hex: the same code produces the
 * right pill in a theme this package has never seen.
 */
import type { JSX } from "react";

import { Chip } from "@12-apps/ui/data-display/Chip";
import { Box } from "@12-apps/ui/mui/Box";
import { useTheme, type Theme } from "@12-apps/ui/mui/styles";

import { stateChipSx } from "./report-surface";

const STATUS_LABELS: Record<string, string> = {
  draft: "Rascunho",
  archived: "Arquivado",
  published: "Publicado",
};

/**
 * A draft is WARNING-toned because "nobody else can see this yet" is a caveat;
 * an archived report is muted because it is out of the way rather than wrong;
 * anything live carries the accent.
 */
function toneFor(theme: Theme, status: string): string {
  if (status === "draft") return theme.palette.warning.main;
  if (status === "archived") return theme.palette.text.secondary;
  return theme.palette.primary.main;
}

export function ReportStatusChip({
  status,
  dataTestId,
}: {
  status: string;
  dataTestId?: string;
}): JSX.Element {
  const theme = useTheme();
  return (
    <Box
      sx={{
        display: "inline-flex",
        "& .MuiChip-root": stateChipSx(toneFor(theme, status), theme.palette.background.paper),
      }}
    >
      <Chip
        label={STATUS_LABELS[status] ?? status}
        size="sm"
        variant="filled"
        {...(dataTestId ? { dataTestId } : {})}
      />
    </Box>
  );
}
