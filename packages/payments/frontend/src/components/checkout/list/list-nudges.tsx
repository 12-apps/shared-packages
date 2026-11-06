import { Box } from "@mui/material";
import { alpha, type Theme } from "@mui/material/styles";
import type { JSX } from "react";

import { InfoOutlinedIcon } from "../icons";
import { useCheckoutComponents } from "../ui";

import type { CheckoutListNudge } from "./price-types";

/**
 * The host's nudges and notes (FUT-4416, L24), between what the bar lists and
 * its button — in "Resumo do pedido" on a computer, after "Total". A nudge is
 * a pill of the brand's tint, the sentence at the left and the link at the
 * right; a note is a neutral bordered box with its (i). Neither is red.
 *
 * Which ones are drawn is decided by the caller (`shownNudges`); a link that
 * chooses a row calls `onChoose`, never a door option.
 */
export function ListNudges({ nudges, onChoose }: {
  nudges: readonly CheckoutListNudge[];
  onChoose: (choose: { method: "PIX" | "CARD" | "HAND_OFF"; funding?: "DEBIT" }) => void;
}): JSX.Element | null {
  if (nudges.length === 0) return null;
  // The nudges, then the notes (L24), each in the host's order.
  const ordered = [...nudges.filter((nudge) => nudge.tone !== "info"), ...nudges.filter((nudge) => nudge.tone === "info")];
  return (
    <Box data-testid="list-nudges" sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      {ordered.map((nudge) => (nudge.tone === "info" ? <InfoNote key={nudge.id} nudge={nudge} /> : <NudgeStrip key={nudge.id} nudge={nudge} onChoose={onChoose} />))}
    </Box>
  );
}

/** "No Pix fica **R$ 126,75**" — the host's text, then its amount in bold. */
function Sentence({ nudge }: { nudge: CheckoutListNudge }): JSX.Element {
  const { Text } = useCheckoutComponents();
  return (
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <Text variant="body" size="sm" as="span">
        {nudge.text}
        {nudge.amountLabel ? (
          <>
            {" "}
            <Box component="b" sx={{ fontWeight: 700, whiteSpace: "nowrap" }}>{nudge.amountLabel}</Box>
          </>
        ) : null}
      </Text>
    </Box>
  );
}

const nudgeTint = (theme: Theme): string => alpha(theme.palette.primary.main, theme.palette.action.selectedOpacity);

/** The tinted strip, with its link at the right. */
function NudgeStrip({ nudge, onChoose }: { nudge: CheckoutListNudge; onChoose: (choose: { method: "PIX" | "CARD" | "HAND_OFF"; funding?: "DEBIT" }) => void }): JSX.Element {
  const { Button } = useCheckoutComponents();
  const { action } = nudge;
  const press = action ? () => ("choose" in action ? onChoose(action.choose) : action.onPress()) : null;
  return (
    <Box
      data-testid={`list-nudge-${nudge.id}`}
      data-tone="nudge"
      sx={{ display: "flex", alignItems: "center", gap: 1, bgcolor: nudgeTint, borderRadius: 5, px: 1.5, py: 0.5, minHeight: (t) => t.spacing(5) }}
    >
      <Sentence nudge={nudge} />
      {action && press ? (
        <Box sx={{ flex: "none", "& button": { whiteSpace: "nowrap" } }}>
          <Button variant="text" color="primary" size="sm" onClick={press} dataTestId={`list-nudge-${nudge.id}-action`}>
            {action.label}
          </Button>
        </Box>
      ) : null}
    </Box>
  );
}

/** The neutral note: a statement, never a gate — no link. */
function InfoNote({ nudge }: { nudge: CheckoutListNudge }): JSX.Element {
  return (
    <Box
      role="note"
      data-testid={`list-nudge-${nudge.id}`}
      data-tone="info"
      sx={{ display: "flex", alignItems: "flex-start", gap: 1, bgcolor: "action.hover", border: "1px solid", borderColor: "divider", borderRadius: 2, px: 1.5, py: 1, color: "text.secondary" }}
    >
      <InfoOutlinedIcon fontSize="small" aria-hidden sx={{ flex: "none", mt: 0.125 }} />
      <Sentence nudge={nudge} />
    </Box>
  );
}

/**
 * The chosen way to pay's own discount (FUT-4416, E26) — "Desconto no Pix
 * −R$ 11,95", one line, in the host's words: after the host's money rows in
 * "Resumo do pedido", and in the bar on a phone.
 */
export function PriceDiscountLine({ discount }: { discount: { label: string; amountLabel: string } }): JSX.Element {
  const { Text } = useCheckoutComponents();
  return (
    <Box data-testid="list-price-discount" sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 2 }}>
      <Text variant="body" size="sm" color="secondary" as="span">
        {discount.label}
      </Text>
      <Box component="span" sx={{ flex: "none", whiteSpace: "nowrap" }}>
        <Text variant="body" size="sm" color="secondary" as="span">
          {discount.amountLabel}
        </Text>
      </Box>
    </Box>
  );
}
