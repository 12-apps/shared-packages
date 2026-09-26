import { Box, Paper, Typography } from "@mui/material";
import { useState, type JSX } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";

// Through the PUBLISHED entry point, deliberately: a symbol dropped from
// `tender-split/index.ts` should fail these stories the way it would fail a host.
import {
  EN_US_TENDER_SPLIT_COPY,
  PT_BR_TENDER_SPLIT_COPY,
  TenderSplit,
  type TenderOption,
  type TenderSplitAnswer,
  type TenderSplitCopy,
} from "../tender-split";

/**
 * "How was it paid?" for money taken in person (`./tender-split`).
 *
 * Tap Dinheiro, then Crédito: the bill splits 50/50. Tap Débito: 33/33/34.
 * Type 200 into Dinheiro and the other two share what it leaves; only the ×
 * lets that 200 go. Type 500 into Dinheiro alone and the change shows. The
 * answer the host would receive prints under the panel.
 */
const meta: Meta = {
  title: "In person/Tender split",
  parameters: { layout: "centered" },
};
export default meta;

type Tender = "CASH" | "CREDIT" | "DEBIT" | "PIX";

/** A host's catalogue: its own names, and cash as the tender that gives change. */
const TENDERS: TenderOption<Tender>[] = [
  { id: "CASH", label: "Dinheiro", icon: <Glyph d="M3 7h18v10H3zM12 9.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5" />, givesChange: true },
  { id: "CREDIT", label: "Crédito", icon: <Glyph d="M3 6h18v12H3zM3 10h18" /> },
  { id: "DEBIT", label: "Débito", icon: <Glyph d="M3 6h18v12H3zM6 14h3M13 14h5" /> },
  { id: "PIX", label: "Pix", icon: <Glyph d="M12 3l9 9-9 9-9-9z" /> },
];

function Glyph({ d }: { d: string }): JSX.Element {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d={d} />
    </svg>
  );
}

function Host({
  copy,
  locale,
  currency,
  totalCents,
}: {
  copy: TenderSplitCopy;
  locale: string;
  currency: string;
  totalCents: number;
}): JSX.Element {
  const [answer, setAnswer] = useState<TenderSplitAnswer<Tender> | null>(null);
  return (
    <Box sx={{ width: 360, display: "flex", flexDirection: "column", gap: 2 }}>
      <Paper sx={{ p: 2.5 }}>
        <TenderSplit
          tenders={TENDERS}
          totalCents={totalCents}
          copy={copy}
          locale={locale}
          currency={currency}
          onConfirm={setAnswer}
          onCancel={() => setAnswer(null)}
        />
      </Paper>
      <Typography component="pre" variant="caption" data-testid="story-answer">
        {answer === null ? "" : JSON.stringify(answer, null, 2)}
      </Typography>
    </Box>
  );
}

export const PtBr: StoryObj = {
  name: "pt-BR, R$ 444,40",
  render: () => <Host copy={PT_BR_TENDER_SPLIT_COPY} locale="pt-BR" currency="BRL" totalCents={44440} />,
};

export const EnUs: StoryObj = {
  name: "en-US, $82.00",
  render: () => <Host copy={EN_US_TENDER_SPLIT_COPY} locale="en-US" currency="USD" totalCents={8200} />,
};
