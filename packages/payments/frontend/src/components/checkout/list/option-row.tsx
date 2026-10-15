import { Box, Radio } from "@mui/material";
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

export function OptionRow({
  name,
  value,
  chosen,
  disabled = false,
  label,
  hint,
  onChoose,
  testId,
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
  /** Rendered only while chosen. */
  children?: ReactNode;
}): JSX.Element {
  const { Text } = useCheckoutComponents();
  return (
    <Box
      data-testid={testId}
      data-chosen={chosen ? "true" : "false"}
      sx={{
        border: "1px solid",
        borderColor: chosen ? "primary.main" : "divider",
        bgcolor: chosen ? chosenTint : "background.paper",
        borderRadius: 2.5,
        px: 1.5,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <Box
        component="label"
        sx={{ display: "flex", alignItems: "center", gap: 1.5, minHeight: (t) => t.spacing(5.5), py: 0.75, cursor: disabled ? "default" : "pointer" }}
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
        <Box sx={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
          <Text variant="body" size="md" as="span">
            {label}
          </Text>
          {hint ? (
            <Text variant="caption" size="sm" color="secondary" as="span">
              {hint}
            </Text>
          ) : null}
        </Box>
      </Box>
      {chosen && children ? (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25, pb: 1.5 }}>{children}</Box>
      ) : null}
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
