"use client";

import { useRef, useState, type JSX, type KeyboardEvent } from "react";

import { Chip } from "@12-apps/ui/data-display/Chip";
import { Button } from "@12-apps/ui/form/Button";
import { Box } from "@12-apps/ui/mui/Box";
import { Stack } from "@12-apps/ui/mui/Stack";
import { Text } from "@12-apps/ui/typography/Text";

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

/** The pendências' list: each entry opens its step at the field. */
function IssuesPanel({
  copy,
  issues,
  onIssue,
}: {
  copy: CompleteDiscountsWebCopy;
  issues: readonly Pendencia[];
  onIssue: (issue: Pendencia) => void;
}): JSX.Element {
  return (
    <Box
      id="discount-issues-panel"
      role="region"
      aria-label={copy.steps.chrome.issuesRegion}
      data-testid="discount-issues-panel"
      sx={{ borderTop: 1, borderColor: "divider", pt: 1 }}
    >
      {issues.map((issue, index) => (
        <Box
          key={`${issue.key}-${index}`}
          component="button"
          type="button"
          onClick={() => onIssue(issue)}
          data-testid={`discount-issue-${index}`}
          sx={{
            display: "flex",
            gap: 1,
            width: "100%",
            alignItems: "center",
            textAlign: "left",
            minHeight: (theme) => theme.spacing(5),
            px: 0.5,
            border: 0,
            borderBottom: 1,
            borderColor: "divider",
            bgcolor: "transparent",
            font: "inherit",
            color: "text.primary",
            cursor: "pointer",
          }}
        >
          <Text as="span" weight="semibold">
            {issue.where}
          </Text>
          <Text as="span">{issue.text}</Text>
        </Box>
      ))}
      <Box sx={{ pt: 0.5 }}>
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
  const [active, setActive] = useState(0);
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
        <Box key={chip.id} sx={{ flexShrink: 0, "& > button": { whiteSpace: "nowrap" } }}>
          <Button
            variant="outline"
            size="sm"
            color={chip.warn ? "warning" : "secondary"}
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

export function FormChrome({
  copy,
  editing,
  dirty,
  issues,
  strip,
  onIssue,
  onChip,
}: {
  copy: CompleteDiscountsWebCopy;
  editing: boolean;
  dirty: boolean;
  issues: readonly Pendencia[];
  strip: readonly StripChip[];
  onIssue: (issue: Pendencia) => void;
  onChip: (chip: StripChip) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const { chrome } = copy.steps;
  const count = fill(issues.length === 1 ? chrome.issuesOne : chrome.issuesOther, { count: issues.length });
  return (
    <Stack spacing={1} data-testid="discount-form-chrome">
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, minHeight: (theme) => theme.spacing(5) }}>
        <StatePill copy={copy} editing={editing} dirty={dirty} />
        {issues.length > 0 && (
          <Box sx={{ ml: "auto", flexShrink: 0, "& > button": { whiteSpace: "nowrap" } }}>
            <Button
              variant="outline"
              size="sm"
              color="warning"
              aria-expanded={open}
              aria-controls="discount-issues-panel"
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
          copy={copy}
          issues={issues}
          onIssue={(issue) => {
            setOpen(false);
            onIssue(issue);
          }}
        />
      )}
      {editing && <StatusStrip copy={copy} chips={strip} onChip={onChip} />}
    </Stack>
  );
}
