"use client";

/**
 * The saved views, rendered INSIDE the Exibir panel rather than in a dropdown
 * of their own.
 *
 * Two levels, both of them replacing the panel's BODY (the tabs stay put):
 * the list of views, and one view's actions. It is a drill-down and not a
 * nested menu on purpose — an absolutely positioned popover inside the panel's
 * own scroll container gets clipped by it, which is how copy.nav.deleteView ends
 * up unreachable. One level, no clipping, and it works on touch.
 */
import ChevronLeftRoundedIcon from "@mui/icons-material/ChevronLeftRounded";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import GroupOutlinedIcon from "@mui/icons-material/GroupOutlined";
import MoreVertRoundedIcon from "@mui/icons-material/MoreVertRounded";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import StarOutlineRoundedIcon from "@mui/icons-material/StarOutlined";
import StarOutlineRoundedIcon2 from "@mui/icons-material/StarOutlineRounded";
import IconButton from "@mui/material/IconButton/index.js";

import KeyboardArrowDownRoundedIcon from "@mui/icons-material/KeyboardArrowDownRounded";
import RestartAltRoundedIcon from "@mui/icons-material/RestartAltRounded";
import SaveOutlinedIcon from "@mui/icons-material/SaveOutlined";

import { useDataViewsCopy } from "./data-views-copy-context";
import { Button } from "../../form/Button";
import { Box } from "../../../mui/Box";
import { Text } from "../../typography/Text";

import type { DisplayPanelView } from "./data-views-display-panel";
import type { SavedViewSummary } from "./data-views-types";

/** What the panel needs to drive the views without owning any of them. */
export interface ViewNavHandlers {
  views: SavedViewSummary[];
  activeViewId?: string | null;
  /** `null` selects the built-in "{copy.nav.mainView}". */
  onSelectView: (id: string | null) => void;
  onEditView: (view: SavedViewSummary) => void;
  onPatchView: (
    view: SavedViewSummary,
    changes: Partial<Pick<SavedViewSummary, "isDefault" | "pinned" | "shared">>,
  ) => void;
  onDeleteView: (view: SavedViewSummary) => void;
}

const rowSx = {
  display: "flex",
  alignItems: "center",
  gap: 1,
  width: "100%",
  px: 1.25,
  py: 1,
  border: 0,
  borderRadius: 1,
  bgcolor: "transparent",
  cursor: "pointer",
  font: "inherit",
  fontSize: "0.8125rem",
  textAlign: "left",
  color: "text.primary",
  "&:hover": { bgcolor: "action.hover" },
} as const;

/** The list: the built-in view, then each saved one with its own "⋮". */
export function ViewsList({
  handlers,
  onOpenActions,
  testIdPrefix,
}: {
  handlers: ViewNavHandlers;
  onOpenActions: (view: SavedViewSummary) => void;
  testIdPrefix: string;
}): React.JSX.Element {
  const copy = useDataViewsCopy();
  const { views, activeViewId, onSelectView } = handlers;
  const onMain = !activeViewId;
  return (
    <Box sx={{ p: 0.75 }} data-testid={`${testIdPrefix}-views-list`}>
      <Box
        component="button"
        type="button"
        onClick={() => onSelectView(null)}
        data-testid={`${testIdPrefix}-view-main`}
        sx={{ ...rowSx, color: onMain ? "primary.main" : "text.primary", fontWeight: onMain ? 600 : 400 }}
      >
        <Box component="span" sx={{ flex: 1 }}>
          {copy.nav.mainView}
        </Box>
        {onMain && <CheckRoundedIcon fontSize="small" />}
      </Box>

      {views.map((view) => {
        const active = view.id === activeViewId;
        return (
          <Box key={view.id} sx={{ display: "flex", alignItems: "center" }}>
            <Box
              component="button"
              type="button"
              onClick={() => onSelectView(view.id)}
              data-testid={`${testIdPrefix}-view-${view.id}`}
              sx={{ ...rowSx, minWidth: 0, color: active ? "primary.main" : "text.primary", fontWeight: active ? 600 : 400 }}
            >
              <Box component="span" sx={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {view.name}
              </Box>
              {/* What the row-menu toggles DID, readable without opening it:
                  a view set as default, pinned or shared says so here. */}
              {view.isDefault && (
                <StarOutlineRoundedIcon fontSize="small" sx={{ color: "warning.main" }} titleAccess={copy.nav.defaultTag} />
              )}
              {view.pinned && (
                <PushPinOutlinedIcon fontSize="small" sx={{ color: "text.disabled" }} titleAccess="Fixada" />
              )}
              {view.shared && (
                <GroupOutlinedIcon fontSize="small" sx={{ color: "text.disabled" }} titleAccess="Compartilhada" />
              )}
              {active && <CheckRoundedIcon fontSize="small" />}
            </Box>
            <IconButton
              size="small"
              onClick={() => onOpenActions(view)}
              aria-label={copy.nav.viewOptions(view.name)}
              data-testid={`${testIdPrefix}-view-${view.id}-menu`}
            >
              <MoreVertRoundedIcon fontSize="small" />
            </IconButton>
          </Box>
        );
      })}

      {views.length === 0 && (
        <Text variant="caption" as="p">
          <Box component="span" sx={{ display: "block", px: 1.25, py: 1.5, color: "text.secondary", lineHeight: 1.6 }}>
            {copy.nav.emptyHint}
          </Box>
        </Text>
      )}
    </Box>
  );
}

/** One view's actions, reached from its "⋮" and left by the back row. */
export function ViewActions({
  view,
  handlers,
  onBack,
  testIdPrefix,
}: {
  view: SavedViewSummary;
  handlers: ViewNavHandlers;
  onBack: () => void;
  testIdPrefix: string;
}): React.JSX.Element {
  const copy = useDataViewsCopy();
  const { onEditView, onPatchView, onDeleteView } = handlers;
  const action = (
    key: string,
    Icon: typeof StarOutlineRoundedIcon2,
    label: string,
    onClick: () => void,
    opts: { on?: boolean; danger?: boolean } = {},
  ): React.JSX.Element => (
    <Box
      component="button"
      type="button"
      onClick={onClick}
      data-testid={`${testIdPrefix}-view-action-${key}`}
      sx={{
        ...rowSx,
        color: opts.danger ? "error.main" : "text.primary",
        "&:hover": { bgcolor: opts.danger ? "error.lighter" : "action.hover" },
      }}
    >
      <Icon fontSize="small" sx={{ color: opts.danger ? "inherit" : "text.disabled" }} />
      <Box component="span" sx={{ flex: 1 }}>
        {label}
      </Box>
      {opts.on && <CheckRoundedIcon fontSize="small" color="primary" />}
    </Box>
  );

  return (
    <Box sx={{ p: 0.75 }} data-testid={`${testIdPrefix}-view-actions`}>
      <Box
        component="button"
        type="button"
        onClick={onBack}
        data-testid={`${testIdPrefix}-view-actions-back`}
        sx={{ ...rowSx, color: "text.secondary", fontSize: "0.75rem" }}
      >
        <ChevronLeftRoundedIcon fontSize="small" />
        <Box component="span" sx={{ flex: 1, fontWeight: 600, color: "text.primary" }}>
          {view.name}
        </Box>
      </Box>
      <Box sx={{ my: 0.5, borderTop: 1, borderColor: "divider" }} />
      {action("edit", EditOutlinedIcon, copy.nav.editView, () => onEditView(view))}
      {action("default", StarOutlineRoundedIcon2, copy.nav.setDefault, () => onPatchView(view, { isDefault: !view.isDefault }), { on: view.isDefault })}
      {action("pin", PushPinOutlinedIcon, copy.nav.pinToSidebar, () => onPatchView(view, { pinned: !view.pinned }), { on: view.pinned })}
      {action("share", GroupOutlinedIcon, copy.nav.shareWithTeam, () => onPatchView(view, { shared: !view.shared }), { on: view.shared })}
      <Box sx={{ my: 0.5, borderTop: 1, borderColor: "divider" }} />
      {action("delete", DeleteOutlineRoundedIcon, copy.nav.deleteView, () => onDeleteView(view), { danger: true })}
    </Box>
  );
}

/** Name, unsaved dot, chevron — the parts, so the toggle has one decision. */
function ToggleContents({
  view,
  open,
  interactive,
  testIdPrefix,
}: {
  view: DisplayPanelView;
  open: boolean;
  interactive: boolean;
  testIdPrefix: string;
}): React.JSX.Element {
  const copy = useDataViewsCopy();
  return (
    <>
      <Box component="span" sx={{ fontWeight: 600 }} data-testid={`${testIdPrefix}-display-view-name`}>
        {view.activeViewName ?? "{copy.nav.mainView}"}
      </Box>
      {view.dirty && (
        <Box
          component="span"
          aria-label={copy.nav.unsavedChanges}
          data-testid={`${testIdPrefix}-display-dirty`}
          sx={{ height: 6, width: 6, borderRadius: "50%", bgcolor: "primary.main" }}
        />
      )}
      {interactive && (
        <KeyboardArrowDownRoundedIcon
          fontSize="small"
          sx={{ color: "text.disabled", transform: open ? "rotate(180deg)" : "none" }}
        />
      )}
    </>
  );
}

/** The name + unsaved dot; a button only when there are views to open. */
function ViewToggle({
  view,
  open,
  onToggle,
  testIdPrefix,
}: {
  view: DisplayPanelView;
  open: boolean;
  onToggle: () => void;
  testIdPrefix: string;
}): React.JSX.Element {
  const interactive = Boolean(view.nav);
  // One decision, not eight: a panel with no views renders the same row as
  // plain text rather than as a button that opens nothing.
  const affordance = interactive
    ? { px: 0.75, py: 0.25, cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }
    : { px: 0, py: 0, cursor: "default" };
  return (
    <Box
      component={interactive ? "button" : "div"}
      type={interactive ? "button" : undefined}
      onClick={interactive ? onToggle : undefined}
      aria-expanded={interactive ? open : undefined}
      data-testid={`${testIdPrefix}-display-view-toggle`}
      sx={{
        ml: "auto",
        display: "flex",
        alignItems: "center",
        gap: 0.75,
        minWidth: 0,
        border: 0,
        borderRadius: 1,
        font: "inherit",
        fontSize: "0.75rem",
        bgcolor: open ? "action.selected" : "transparent",
        ...affordance,
      }}
    >
      <ToggleContents view={view} open={open} interactive={interactive} testIdPrefix={testIdPrefix} />
    </Box>
  );
}

/** The VISÃO row above the tabs. */
export function ViewHeader(props: {
  view: DisplayPanelView;
  open: boolean;
  onToggle: () => void;
  testIdPrefix: string;
}): React.JSX.Element {
  const copy = useDataViewsCopy();
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 1, borderBottom: 1, borderColor: "divider" }}>
      <Text variant="caption" as="span">
        <Box component="span" sx={{ textTransform: "uppercase", letterSpacing: 0.5, color: "text.disabled" }}>
          {copy.nav.label}
        </Box>
      </Text>
      <ViewToggle {...props} />
    </Box>
  );
}

/** Redefinir / Salvar como nova / Atualizar, pinned below the tabs. */
export function ViewFooter({
  view,
  onDone,
  testIdPrefix,
}: {
  view: DisplayPanelView;
  onDone: () => void;
  testIdPrefix: string;
}): React.JSX.Element {
  const copy = useDataViewsCopy();
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 1,
        px: 1.5,
        py: 1,
        borderTop: 1,
        borderColor: "divider",
        bgcolor: "action.hover",
      }}
    >
      <Button
        variant="text"
        size="sm"
        color="neutral"
        disabled={!view.dirty}
        startIcon={<RestartAltRoundedIcon fontSize="small" />}
        onClick={view.onReset}
        dataTestId={`${testIdPrefix}-display-reset`}
      >
        {copy.nav.reset}
      </Button>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        {/* Only meaningful with a view APPLIED: on {copy.nav.mainView} the single
            "Salvar visão" already is "save as new". */}
        {view.onUpdate && (
          <Button
            variant="text"
            size="sm"
            color="neutral"
            onClick={() => {
              view.onSaveAs();
              onDone();
            }}
            dataTestId={`${testIdPrefix}-display-save-as`}
          >
            {copy.nav.saveAs}
          </Button>
        )}
        {/* Enabled only when something in Ordenar / Colunas / Exibição (or the
            filters the view also stores) differs from the applied view: the
            filled button is a STATE — "there is something to save" — not a
            permanent fixture. */}
        <Button
          size="sm"
          disabled={!view.dirty}
          startIcon={<SaveOutlinedIcon fontSize="small" />}
          onClick={() => {
            (view.onUpdate ?? view.onSaveAs)();
            onDone();
          }}
          dataTestId={`${testIdPrefix}-display-save`}
        >
          {view.onUpdate ? copy.nav.update : copy.nav.save}
        </Button>
      </Box>
    </Box>
  );
}

