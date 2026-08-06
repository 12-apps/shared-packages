"use client";

import FilterAltOffRoundedIcon from "@mui/icons-material/FilterAltOffRounded";
import InboxRoundedIcon from "@mui/icons-material/InboxRounded";

import { Button } from "../../form/Button";
import { Box } from "../../../mui/Box";
import { Text } from "../../typography/Text";

/**
 * TWO EMPTY STATES, NOT ONE.
 *
 * "Nenhum pagamento registrado" under an active filter is a lie, and it is the
 * expensive kind: the operator reads it as "this store has no payments" and
 * goes looking for the bug somewhere else. The page's own empty copy answers
 * "there is nothing here yet"; it cannot answer "nothing matches what you
 * typed", because it does not know what was typed.
 *
 * So the grid renders the FILTERED variant itself — it is the only party that
 * knows a filter is applied — and defers to the host's `emptyState` only when
 * the list is genuinely empty. The filtered one carries the way out, which is
 * the whole point: the fix is one click, and it is right there.
 */
export function DataViewsEmpty({
  filtered,
  onClearFilters,
  emptyState,
  testIdPrefix,
}: {
  /** Is anything narrowing the list right now (search, pills or ranges)? */
  filtered: boolean;
  onClearFilters: () => void;
  /** The page's own copy for a genuinely empty list. */
  emptyState?: React.ReactNode;
  testIdPrefix: string;
}): React.JSX.Element {
  const Icon = filtered ? FilterAltOffRoundedIcon : InboxRoundedIcon;
  return (
    <Box
      data-testid={`${testIdPrefix}-empty${filtered ? "-filtered" : ""}`}
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        py: 8,
        px: 2,
      }}
    >
      <Box
        sx={{
          display: "inline-flex",
          p: 2,
          mb: 1.5,
          borderRadius: "50%",
          bgcolor: "action.hover",
          color: "text.disabled",
        }}
      >
        <Icon />
      </Box>
      {filtered ? (
        <>
          <Text variant="body" as="p">
            <Box component="span" sx={{ fontWeight: 600 }}>
              Nenhum resultado para esses filtros
            </Box>
          </Text>
          <Text variant="caption" as="p">
            <Box component="span" sx={{ display: "block", mt: 0.5, mb: 2, color: "text.secondary", maxWidth: 380 }}>
              Ajuste ou remova os filtros.
            </Box>
          </Text>
          <Button
            variant="outline"
            size="sm"
            color="secondary"
            onClick={onClearFilters}
            dataTestId={`${testIdPrefix}-empty-clear`}
          >
            Limpar filtros
          </Button>
        </>
      ) : (
        // The page's own words for "nothing here yet" — it knows what the
        // entity is and how one comes to exist; this component does not.
        emptyState
      )}
    </Box>
  );
}
