"use client";

import type { JSX } from "react";

import { Alert } from "@12-apps/ui/data-display/Alert";
import { Box } from "@12-apps/ui/mui/Box";
import { Link } from "@12-apps/ui/mui/Link";

import type { DiscountsWebCopy } from "./copy";

/**
 * "Datas indisponíveis" (FUT-4482, review round 4): a rule written in the
 * store's zone that the server cannot place now, because that zone is not one
 * it knows. Said once above the list, above the form's boxes, and — where the
 * list's Vigência cell is off-screen — under the row's name.
 */

/**
 * Where the host's own time-zone setting is (review round 4): a route, or a
 * handler for a host that opens it some other way. Optional — without it the
 * notice names the cause and offers no link. One or the other, never both —
 * which would win is a guess (review round 5). The label is the packs'
 * `window.openTimeZone`, never the host's: copy ships bilingual.
 */
export type DiscountsTimeZoneSettings =
  | { href: string; onClick?: never }
  | { onClick: () => void; href?: never };

function SettingsLink({
  settings,
  label,
}: {
  settings: DiscountsTimeZoneSettings;
  label: string;
}): JSX.Element {
  const look = { color: "inherit", fontWeight: 600, alignSelf: "flex-start" } as const;
  if (settings.href !== undefined) {
    return (
      <Link href={settings.href} underline="always" sx={look} data-testid="discounts-open-time-zone">
        {label}
      </Link>
    );
  }
  return (
    <Link
      component="button"
      type="button"
      onClick={settings.onClick}
      underline="always"
      sx={{ ...look, font: "inherit", fontWeight: 600 }}
      data-testid="discounts-open-time-zone"
    >
      {label}
    </Link>
  );
}

/**
 * The notice itself: warning (amber), never danger — nothing failed that the
 * operator did.
 */
export function DaysUnknownNotice({
  copy,
  message,
  timeZoneSettings,
  dataTestId,
}: {
  copy: DiscountsWebCopy;
  message: string;
  timeZoneSettings?: DiscountsTimeZoneSettings | undefined;
  dataTestId: string;
}): JSX.Element {
  return (
    <Alert
      variant="warning"
      animate={false}
      description={message}
      data-testid={dataTestId}
      sx={{
        // The Alert's icon slot carries MUI's 7px below the glyph, which made a
        // one-line box a line taller than its text with the words at the top.
        // Without it the glyph is one line tall (22px against a 22.8px line),
        // so one line sits centred, and a wrapped message keeps the icon on
        // its first line.
        paddingY: 1.5,
        "& .MuiAlert-icon": { paddingY: 0 },
      }}
    >
      {timeZoneSettings ? <SettingsLink settings={timeZoneSettings} label={copy.window.openTimeZone} /> : null}
    </Alert>
  );
}

/** One notice above the list whenever any row's days are unknown; nothing otherwise. */
export function DaysUnknownListNotice({
  rows,
  copy,
  timeZoneSettings,
}: {
  rows: readonly { record: { daysUnknown?: boolean | undefined } }[];
  copy: DiscountsWebCopy;
  timeZoneSettings?: DiscountsTimeZoneSettings | undefined;
}): JSX.Element | null {
  if (!rows.some((row) => row.record.daysUnknown === true)) return null;
  return (
    <Box sx={{ marginBottom: 2 }}>
      <DaysUnknownNotice
        copy={copy}
        message={copy.window.daysUnknownList}
        timeZoneSettings={timeZoneSettings}
        dataTestId="discounts-days-unknown-notice"
      />
    </Box>
  );
}

/**
 * The short words under a row's name, for the widths where the table's
 * Vigência cell has scrolled off to the right: below `lg` the nine columns
 * do not fit beside the admin's rails (measured: off-screen at 900, on screen
 * at 1280), so the grid scrolls sideways. From `lg` the cell itself says them.
 */
export function DaysUnknownMarker({ copy }: { copy: DiscountsWebCopy }): JSX.Element {
  return (
    <Box
      component="span"
      data-testid="discount-days-unknown-marker"
      sx={{
        display: { xs: "block", lg: "none" },
        color: "warning.dark",
        typography: "caption",
        fontWeight: 600,
      }}
    >
      {copy.window.daysUnknown}
    </Box>
  );
}

/** The Nome cell: the name, and the marker when the row's days are unknown. */
export function nameCell(
  row: { name: string; record: { daysUnknown?: boolean | undefined } },
  copy: DiscountsWebCopy,
): JSX.Element {
  return (
    <>
      <span>{row.name}</span>
      {row.record.daysUnknown === true ? <DaysUnknownMarker copy={copy} /> : null}
    </>
  );
}
