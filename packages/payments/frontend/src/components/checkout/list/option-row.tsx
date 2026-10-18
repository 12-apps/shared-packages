import { Box, Radio, type SxProps } from "@mui/material";
import { alpha, type Theme } from "@mui/material/styles";
import type { JSX, ReactNode } from "react";

import { useCheckoutComponents } from "../ui";

/**
 * One row of the one list (FUT-3591): a radio, its label and hint, and — while
 * chosen — what opens inside it.
 *
 * Chosen, the row takes a tint of the primary colour and a thin primary
 * border; otherwise it is the surface with a neutral one (the prototype's
 * `.opt` / `.opt.on`). What opens inside starts at the row's own padding,
 * under the radio, never indented past it (the owner's "remove this gap").
 *
 * The radio is MUI's own: the slot contract's `RadioGroup` lays out a group of
 * label-only options and has no room for content opened inside one, and MUI
 * is already this package's peer. Every row shares one `name`, so the online
 * and the door options are ONE group to the keyboard and to a screen reader.
 */
const chosenTint = (theme: Theme): string => alpha(theme.palette.primary.main, theme.palette.action.selectedOpacity);

/**
 * The fields opened inside a chosen row stand on the surface, not on its tint
 * (the prototype's `.inp`, `background: var(--surface)`). The floating label
 * keeps no fill of its own: a filled label would stand above the outline as a
 * tab of surface on the tint.
 */
const FIELDS_ON_SURFACE = {
  "& .MuiOutlinedInput-root": { bgcolor: "background.paper" },
  // A field's complaint stays on the tint, under the field: at night the error
  // role's lighter tone (MUI dark #f44336 is 4.05:1 on the 16% tint).
  "& .MuiFormHelperText-root.Mui-error": {
    color: (t: Theme) => (t.palette.mode === "dark" ? t.palette.error.light : t.palette.error.main),
  },
} as const;

/** The row's label and its muted hint, beside the radio. */
function RowWords({ label, hint }: { label: string; hint?: string }): JSX.Element {
  const { Text } = useCheckoutComponents();
  return (
    <Box sx={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
      <Text variant="body" size="md" as="span">
        {label}
      </Text>
      {hint ? (
        <Text variant="body" size="sm" color="secondary" as="span">
          {hint}
        </Text>
      ) : null}
    </Box>
  );
}

/** What opens inside a row, its fields standing on the surface. */
function RowContent({ testId, children }: { testId: string; children: ReactNode }): JSX.Element {
  return (
    <Box data-testid={`${testId}-content`} sx={{ display: "flex", flexDirection: "column", gap: 1.25, pb: 1.5, ...FIELDS_ON_SURFACE }}>
      {children}
    </Box>
  );
}

/** The row's frame: tinted and outlined while chosen, dimmed while disabled. */
function rowFrameSx(chosen: boolean, disabled: boolean): SxProps<Theme> {
  return {
    border: "1px solid",
    borderColor: chosen ? "primary.main" : "divider",
    bgcolor: chosen ? chosenTint : "background.paper",
    borderRadius: 2.5,
    px: 1.5,
    opacity: disabled ? 0.6 : 1,
    // The keyboard's place in the group, drawn on the whole row (5.1 item 6)
    // — for the row's own radio only: a field opened inside draws its own
    // ring, and a second one around the row doubled it.
    "&:has(> label input[type='radio']:focus-visible)": { outline: (t) => `${t.spacing(0.25)} solid ${t.palette.primary.main}`, outlineOffset: (t) => t.spacing(0.25) },
  };
}

export function OptionRow({
  name,
  value,
  chosen,
  disabled = false,
  label,
  hint,
  onChoose,
  testId,
  open = false,
  children,
}: {
  /** The group's name, shared by every row. */
  name: string;
  value: string;
  chosen: boolean;
  disabled?: boolean;
  label: string;
  hint?: string;
  onChoose: () => void;
  testId: string;
  /** Render `children` while NOT chosen too (a door option's `showContentWhileIdle`). */
  open?: boolean;
  /** Rendered only while chosen, unless `open`. */
  children?: ReactNode;
}): JSX.Element {
  return (
    <Box
      data-testid={testId}
      data-chosen={chosen ? "true" : "false"}
      sx={rowFrameSx(chosen, disabled)}
    >
      <Box
        component="label"
        // The prototype's `.opt` padding, 12px above and below the label and its
        // hint (FUT-3685 review): a row with a hint is ~62px, and the hint never
        // touches — or is clipped by — the row's border. 48px is the floor, for
        // a row with no hint.
        sx={{ display: "flex", alignItems: "center", gap: 1.5, minHeight: (t) => t.spacing(6), py: 1.5, cursor: disabled ? "default" : "pointer" }}
      >
        <Radio
          name={name}
          value={value}
          checked={chosen}
          disabled={disabled}
          onChange={onChoose}
          size="small"
          sx={{ p: 0, flex: "none" }}
          inputProps={{ "data-testid": `${testId}-radio` } as Record<string, string>}
        />
        <RowWords label={label} hint={hint} />
      </Box>
      {/* Only a row with something to open draws the box for it — no empty band. */}
      {(chosen || open) && children ? <RowContent testId={testId}>{children}</RowContent> : null}
    </Box>
  );
}

/**
 * "PAGAR AGORA, PELO APP" / "PAGAR NA ENTREGA" — the theme's overline (small
 * capitals, its own tracking), bold and muted. `id` labels the group under it.
 */
export function GroupHeading({ id, children }: { id: string; children: string }): JSX.Element {
  return (
    <Box component="p" id={id} sx={{ m: 0, typography: "overline", lineHeight: 1.5, fontWeight: 700, color: "text.secondary" }}>
      {children}
    </Box>
  );
}
