"use client";

import { useId, useRef, useState, type JSX, type KeyboardEvent } from "react";

import { Chip } from "@12-apps/ui/data-display/Chip";
import { Button } from "@12-apps/ui/form/Button";
import { Box } from "@12-apps/ui/mui/Box";
import { Link } from "@12-apps/ui/mui/Link";
import { List } from "@12-apps/ui/mui/List";
import { ListItemButton } from "@12-apps/ui/mui/ListItemButton";
import { Stack } from "@12-apps/ui/mui/Stack";
import { alpha, type Theme } from "@12-apps/ui/mui/styles";
import { Text } from "@12-apps/ui/typography/Text";
import { darken } from "@12-apps/ui/mui/styles";

import { fill, type CompleteDiscountsWebCopy } from "./copy";
import type { Pendencia } from "./step-keys";
import type { StripChip } from "./step-summary";

/**
 * The block over the steps (FUT-4478, Story "Chrome"), copied from the product
 * editor: the state pill, the "N pendências" button and its panel, and — when
 * editing — the status strip. It sits inside the form body, sticky at the top
 * of the dialog's scroll area, so `UsableModal` needs no header slot and the
 * standalone form shows the same chrome.
 */

/** "Não salvo" while creating; "Salvo" / "Alterações não salvas" while editing. */
function StatePill({ copy, editing, dirty }: { copy: CompleteDiscountsWebCopy; editing: boolean; dirty: boolean }): JSX.Element {
  const { chrome } = copy.steps;
  const saved = editing && !dirty;
  return (
    <Chip
      size="sm"
      variant="soft"
      color={saved ? "success" : "warning"}
      label={saved ? chrome.saved : editing ? chrome.dirty : chrome.unsaved}
      dataTestId="discount-state-pill"
    />
  );
}

/** The warning ink the state pill uses on its own tint: warning.dark, 20% darker (light); warning.light (dark). */
function warningInk(theme: Theme): string {
  const { warning, mode } = theme.palette;
  return mode === "dark" ? warning.light : darken(warning.dark, 0.2);
}

/** The pendências' list, a warning band: each entry opens its step at the field. */
function IssuesPanel({
  id,
  copy,
  issues,
  onIssue,
}: {
  id: string;
  copy: CompleteDiscountsWebCopy;
  issues: readonly Pendencia[];
  onIssue: (issue: Pendencia) => void;
}): JSX.Element {
  return (
    <Box
      id={id}
      role="region"
      aria-label={copy.steps.chrome.issuesRegion}
      data-testid="discount-issues-panel"
      sx={{ bgcolor: (theme) => alpha(theme.palette.warning.main, 0.1), borderRadius: 1, px: 1, py: 0.5 }}
    >
      <List disablePadding>
        {issues.map((issue, index) => (
          <ListItemButton
            key={`${issue.key}-${index}`}
            onClick={() => onIssue(issue)}
            data-testid={`discount-issue-${index}`}
            sx={{ gap: 1, minHeight: (theme) => theme.spacing(5), px: 0.5, borderRadius: 0.5 }}
          >
            {/* Warning ink as the state pill draws it on the same tint: the dark
                step, darkened, since warning.dark alone is too light there (FUT-4464). */}
            <Box component="span" sx={{ color: warningInk, fontWeight: 600 }}>
              {issue.where}
            </Box>
            <Text as="span">{issue.text}</Text>
          </ListItemButton>
        ))}
      </List>
      <Box sx={{ px: 0.5, pb: 0.5 }}>
        <Text variant="caption">{copy.steps.chrome.issuesFoot}</Text>
      </Box>
    </Box>
  );
}

/** Toolbar keyboard model: one Tab stop, then ←/→, Home, End (the product editor's strip). */
function StatusStrip({
  copy,
  chips,
  onChip,
}: {
  copy: CompleteDiscountsWebCopy;
  chips: readonly StripChip[];
  onChip: (chip: StripChip) => void;
}): JSX.Element {
  const [chosen, setActive] = useState(0);
  // The chip count changes with the kind (a combo has no first-purchase chip):
  // clamped, so the toolbar always keeps exactly one Tab stop.
  const active = Math.min(chosen, chips.length - 1);
  const bar = useRef<HTMLDivElement>(null);
  const move = (event: KeyboardEvent<HTMLDivElement>): void => {
    const last = chips.length - 1;
    const keys: Record<string, number> = { ArrowRight: Math.min(last, active + 1), ArrowLeft: Math.max(0, active - 1), Home: 0, End: last };
    const next = keys[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setActive(next);
    bar.current?.querySelectorAll<HTMLElement>("button")[next]?.focus();
  };
  return (
    <Box
      ref={bar}
      role="toolbar"
      aria-label={copy.steps.chrome.strip}
      onKeyDown={move}
      data-testid="discount-status-strip"
      sx={{ display: "flex", gap: 1, overflowX: "auto", flexWrap: "nowrap", py: 0.5 }}
    >
      {chips.map((chip, index) => (
        <Box
          key={chip.id}
          sx={{
            flexShrink: 0,
            // The mock's neutral pills: ink and a hairline, warning only for "Pausado".
            "& > button": chip.warn
              ? { whiteSpace: "nowrap", borderRadius: 999 }
              : { whiteSpace: "nowrap", borderRadius: 999, color: "text.primary", borderColor: "divider" },
          }}
        >
          <Button
            variant="outline"
            size="sm"
            color={chip.warn ? "warning" : "neutral"}
            tabIndex={index === active ? 0 : -1}
            onFocus={() => setActive(index)}
            onClick={() => onChip(chip)}
            dataTestId={`discount-strip-${chip.id}`}
          >
            {chip.label}
          </Button>
        </Box>
      ))}
    </Box>
  );
}

/** "Ver tudo numa página" / "Voltar ao passo a passo" while creating: a text link on the chrome's row. */
interface SeeAll {
  all: boolean;
  onToggle: () => void;
}

export function FormChrome({
  copy,
  editing,
  dirty,
  issues,
  strip,
  seeAll,
  onIssue,
  onChip,
}: {
  copy: CompleteDiscountsWebCopy;
  editing: boolean;
  dirty: boolean;
  issues: readonly Pendencia[];
  strip: readonly StripChip[];
  seeAll: SeeAll | null;
  onIssue: (issue: Pendencia) => void;
  onChip: (chip: StripChip) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const { chrome } = copy.steps;
  const count = fill(issues.length === 1 ? chrome.issuesOne : chrome.issuesOther, { count: issues.length });
  return (
    <Stack spacing={1} data-testid="discount-form-chrome">
      {/* ONE row (the prototype's header): the pill, then Ver tudo while creating
          or the status strip while editing, and the pendências at its end. */}
      <Box sx={{ display: "flex", flexWrap: editing ? "nowrap" : "wrap", alignItems: "center", columnGap: 1, rowGap: 0.5, minHeight: (theme) => theme.spacing(5) }}>
        <StatePill copy={copy} editing={editing} dirty={dirty} />
        {seeAll && (
          <Link
            component="button"
            type="button"
            variant="body2"
            underline="hover"
            onClick={seeAll.onToggle}
            data-testid="discount-see-all"
            sx={{ fontWeight: 600, minHeight: (theme) => theme.spacing(5), whiteSpace: "nowrap" }}
          >
            {seeAll.all ? copy.steps.backToSteps : copy.steps.seeAll}
          </Link>
        )}
        {editing && (
          <Box sx={{ flex: "1 1 0", minWidth: 0 }}>
            <StatusStrip copy={copy} chips={strip} onChip={onChip} />
          </Box>
        )}
        {issues.length > 0 && (
          <Box sx={{ ml: "auto", flexShrink: 0, "& > button": { whiteSpace: "nowrap" } }}>
            <Button
              variant="outline"
              size="sm"
              color="warning"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => setOpen(!open)}
              dataTestId="discount-issues-button"
            >
              {count}
            </Button>
          </Box>
        )}
      </Box>
      {open && issues.length > 0 && (
        <IssuesPanel
          id={panelId}
          copy={copy}
          issues={issues}
          onIssue={(issue) => {
            setOpen(false);
            onIssue(issue);
          }}
        />
      )}
    </Stack>
  );
}
