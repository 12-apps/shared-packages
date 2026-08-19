"use client";

import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import type { CSSObject, Theme } from "@mui/material";
import { Box } from "@mui/material";
import React from "react";

import {
  atLeastRail,
  displayAcrossRail,
  TOUCH_TARGET,
} from "./SettingsLayout.styles";
import { SettingsSectionChips } from "./SettingsSectionChips";
import { SettingsSectionHeader } from "./SettingsSectionHeader";
import type {
  SettingsLayoutProps,
  SettingsNavItem,
  SettingsRailBreakpoint,
} from "./SettingsLayout.types";

export interface SettingsPanelProps {
  /** True in `drilldown`, inside a section rather than at the index. */
  inSection: boolean;
  /** True in `drilldown`, at the area's index. */
  hideOnNarrow: boolean;
  breakpoint: SettingsRailBreakpoint;
  indexHref?: string;
  backLabel: string;
  /** The open section's own name — turns the back link into a compact header. */
  sectionTitle?: string;
  /** One line under that name. */
  sectionDescription?: string;
  ariaLabel: string;
  sectionChips?: SettingsNavItem[];
  activeItemId?: string;
  linkComponent?: SettingsLayoutProps["linkComponent"];
  onSelectItem?: (id: string) => void;
  testIdPrefix: string;
  children: React.ReactNode;
  /** Scroll inside the panel rather than with the page. See `fillHeight`. */
  fillHeight?: boolean;
}

/** The way back to the area's index — narrow widths only. */
function BackLink({
  href,
  label,
  breakpoint,
  linkComponent,
  testIdPrefix,
}: {
  href: string;
  label: string;
  breakpoint: SettingsRailBreakpoint;
  linkComponent: NonNullable<SettingsLayoutProps["linkComponent"]>;
  testIdPrefix: string;
}): React.JSX.Element {
  return (
    <Box
      component={linkComponent}
      href={href}
      aria-label={label}
      data-testid={`${testIdPrefix}-back`}
      sx={(theme) => ({
        ...displayAcrossRail(theme, breakpoint, "inline-flex", "none"),
        alignItems: "center",
        gap: 0.5,
        minHeight: TOUCH_TARGET,
        pr: 1,
        textDecoration: "none",
        color: "text.secondary",
        font: "inherit",
        fontSize: "0.875rem",
      })}
    >
      <ChevronLeftIcon fontSize="small" />
      {label}
    </Box>
  );
}

/**
 * Two shapes of the same control, chosen by whether the host named the section.
 *
 * With a `sectionTitle` the back folds into a compact header that also says
 * where you are; without one the original text link is kept, so no existing
 * consumer's header grows a title and pushes their first field down the page on
 * upgrade. Its own component so `SettingsPanel` keeps one branch rather than
 * three.
 */
function PanelBack({
  href,
  backLabel,
  sectionTitle,
  sectionDescription,
  breakpoint,
  linkComponent,
  testIdPrefix,
}: {
  href: string;
  backLabel: string;
  sectionTitle?: string;
  sectionDescription?: string;
  breakpoint: SettingsRailBreakpoint;
  linkComponent: NonNullable<SettingsLayoutProps['linkComponent']>;
  testIdPrefix: string;
}): React.JSX.Element {
  if (sectionTitle === undefined) {
    return (
      <BackLink
        href={href}
        label={backLabel}
        breakpoint={breakpoint}
        linkComponent={linkComponent}
        testIdPrefix={testIdPrefix}
      />
    );
  }
  return (
    <SettingsSectionHeader
      href={href}
      backLabel={backLabel}
      title={sectionTitle}
      description={sectionDescription}
      breakpoint={breakpoint}
      linkComponent={linkComponent}
      testIdPrefix={testIdPrefix}
    />
  );
}

/**
 * The panel's own box, as ONE object per media query rather than two.
 *
 * Both the `display` rule and `fillHeight`'s belong at the same wide-shape
 * query, and spreading them as separate `{ [query]: … }` objects makes the
 * second REPLACE the first — so turning `fillHeight` on silently dropped the
 * `display: block` that `hideOnNarrow` puts there and left the panel
 * `display: none` at every width. That only shows at a drilldown INDEX, where
 * `hideOnNarrow` is true, which is why a section route looked fine.
 *
 * `overflowY` here is also what lets a `position: sticky` toolbar inside
 * `children` pin to the TOP OF THE PANEL — under the host's header — instead
 * of to a document that is not the scroller.
 */
function panelSx(
  breakpoint: SettingsRailBreakpoint,
  hideOnNarrow: boolean,
  fillHeight: boolean,
): (theme: Theme) => CSSObject {
  return (theme) => ({
    display: hideOnNarrow ? "none" : "block",
    flex: "1 1 auto",
    minWidth: 0,
    width: "100%",
    [atLeastRail(theme, breakpoint)]: {
      ...(hideOnNarrow ? { display: "block" } : {}),
      ...(fillHeight
        ? {
            height: "100%",
            minHeight: 0,
            overflowY: "auto",
            overscrollBehavior: "contain",
          }
        : {}),
    },
  });
}

/**
 * The central column: the open screen, and — in `drilldown`, inside a section —
 * the back link and sibling-section strip above it.
 *
 * At the index in `drilldown` this whole column is `display: none` below the
 * breakpoint and the rail becomes the page. Mounted either way: the panel and
 * the list are one tree with `display` between them, not two branches of a
 * render.
 */
export function SettingsPanel({
  inSection,
  hideOnNarrow,
  breakpoint,
  indexHref,
  backLabel,
  sectionTitle,
  sectionDescription,
  ariaLabel,
  sectionChips,
  activeItemId,
  linkComponent,
  onSelectItem,
  testIdPrefix,
  fillHeight = false,
  children,
}: SettingsPanelProps): React.JSX.Element {
  const showBack =
    inSection && indexHref !== undefined && linkComponent !== undefined;
  const showChips =
    inSection && sectionChips !== undefined && sectionChips.length > 0;

  return (
    <Box
      data-testid={`${testIdPrefix}-panel`}
      sx={panelSx(breakpoint, hideOnNarrow, fillHeight)}
    >
      {showBack ? (
        <PanelBack
          href={indexHref}
          backLabel={backLabel}
          sectionTitle={sectionTitle}
          sectionDescription={sectionDescription}
          breakpoint={breakpoint}
          linkComponent={linkComponent}
          testIdPrefix={testIdPrefix}
        />
      ) : null}

      {showChips ? (
        <Box
          sx={(theme) => ({
            ...displayAcrossRail(theme, breakpoint, "block", "none"),
            mb: 1,
            minWidth: 0,
          })}
        >
          <SettingsSectionChips
            items={sectionChips}
            activeItemId={activeItemId}
            ariaLabel={ariaLabel}
            linkComponent={linkComponent}
            onSelectItem={onSelectItem}
            testIdPrefix={testIdPrefix}
          />
        </Box>
      ) : null}

      {children}
    </Box>
  );
}
