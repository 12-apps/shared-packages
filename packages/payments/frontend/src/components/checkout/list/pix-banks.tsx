import { Box } from "@mui/material";
import { useCallback, useEffect, useRef, useState, type JSX } from "react";

import { Emphasized } from "../pix-parts";
import { useCheckoutComponents } from "../ui";

import { BankLogo } from "./bank-logos";
import { openBankApp, PIX_BANKS, type PhoneOs } from "./bank-apps";
import type { CheckoutPixBank, PixBankId } from "./types";

/**
 * The after-copy face's way to the bank app (FUT-3612), on a phone: with no
 * bank chosen, the six as a 2×3 grid of large buttons under "Abra seu banco e
 * cole em Pix copia e cola"; with one, "Abrindo o **Nubank**…" and "Outro
 * banco" in one row — or, when the app did not open, the sentence that says so
 * with "Tentar de novo".
 */

export type BankStatus = "opening" | "failed";

export interface PixBankState {
  /** The bank this face opens, or `null` while the grid is shown. */
  chosen: PixBankId | null;
  status: BankStatus | null;
  /** Open `bank` (a pick from the grid remembers it). */
  open: (bank: PixBankId, remember: boolean) => void;
  /** "Outro banco": the grid again. The stored bank is replaced only by the next pick. */
  showGrid: () => void;
}

/**
 * The bank face's state. It starts on the remembered bank — unless the press
 * asked for the grid ("Abrir outro banco") — and never opens anything while
 * the code is veiled (FUT-3535: an app opened then would paste the old amount).
 */
export function usePixBankState(
  remembered: PixBankId | null,
  onPick: (bank: PixBankId) => void,
  os: PhoneOs | null,
  stale: boolean,
  startOnGrid: boolean,
): PixBankState {
  const [chosen, setChosen] = useState<PixBankId | null>(startOnGrid ? null : remembered);
  const [status, setStatus] = useState<BankStatus | null>(null);
  const live = useRef(true);
  useEffect(() => {
    // Set in the body too: a remount (StrictMode's, or a parent's) runs the
    // cleanup first, and a flag left false would swallow every "não abriu".
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const open = useCallback(
    (next: PixBankId, remember: boolean) => {
      if (stale || !os) return;
      setChosen(next);
      setStatus("opening");
      if (remember) onPick(next);
      void openBankApp(next, os).then((opened) => {
        if (live.current && !opened) setStatus("failed");
      });
    },
    [os, onPick, stale],
  );
  const showGrid = useCallback(() => {
    setChosen(null);
    setStatus(null);
  }, []);
  return { chosen, status, open, showGrid };
}

function OtherLink({ label, onClick, testId }: { label: string; onClick: () => void; testId: string }): JSX.Element {
  const { Button } = useCheckoutComponents();
  return (
    <Box sx={{ ml: "auto", flex: "none", "& button": { textDecoration: "underline", minHeight: (t) => t.spacing(5.5), px: 0.5 } }}>
      <Button variant="text" color="primary" size="sm" onClick={onClick} dataTestId={testId}>
        {label}
      </Button>
    </Box>
  );
}

/** "Abrindo o **Nubank**…" · "Outro banco" — or "Não conseguimos abrir…" · "Tentar de novo" · "Outro banco". */
function Opening({ bank, state, chosen }: { bank: CheckoutPixBank; state: PixBankState; chosen: PixBankId }): JSX.Element {
  const { Button, Text } = useCheckoutComponents();
  const name = bank.copy.names[chosen];
  const failed = state.status === "failed";
  return (
    <Box data-testid="pix-bank-opening" data-status={state.status ?? "opening"} sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 1 }}>
      <Box component="span" role={failed ? "alert" : "status"} sx={{ minWidth: 0 }}>
        <Text variant="body" size="sm" as="span">
          {failed ? bank.copy.notOpened(name) : <Emphasized text={bank.copy.opening(name)} />}
        </Text>
      </Box>
      {failed ? (
        <Box sx={{ "& button": { minHeight: (t) => t.spacing(5.5) } }}>
          <Button variant="outline" color="primary" size="sm" onClick={() => state.open(chosen, false)} dataTestId="pix-bank-retry">
            {bank.copy.retry}
          </Button>
        </Box>
      ) : null}
      <OtherLink label={bank.copy.other} onClick={state.showGrid} testId="pix-bank-other" />
    </Box>
  );
}

/** One of the six: the bank's logo at 32px and its name, ≈56px tall. */
/** The grid's own width, never the window's: under it, a cell is too narrow for logo and name side by side. */
const NARROW_GRID = "@container pixbanks (max-width: 289.95px)";

function BankButton({ bank, id, onPick, disabled }: { bank: CheckoutPixBank; id: PixBankId; onPick: () => void; disabled: boolean }): JSX.Element {
  const { Button } = useCheckoutComponents();
  const name = bank.copy.names[id];
  const label = bank.copy.open(name);
  const lead = label.slice(0, label.lastIndexOf(name.name));
  return (
    <Box
      sx={{
        minWidth: 0,
        "& button": {
          width: "100%",
          minHeight: (t) => t.spacing(7),
          borderRadius: 1.5,
          justifyContent: "flex-start",
          textAlign: "left",
          gap: 1.25,
          px: 1.5,
          color: "text.primary",
          borderColor: "divider",
          // A 320px phone gives the grid ~254px (each half ~123px): logo
          // beside "Santander" no longer fits, so the logo goes above the name.
          [NARROW_GRID]: {
            flexDirection: "column",
            justifyContent: "center",
            textAlign: "center",
            gap: 0.5,
            px: 1,
            py: 1,
            "& .MuiButton-startIcon, & .MuiButton-start": { m: 0 },
          },
        },
        "& button, & button *": { fontWeight: 600 },
      }}
    >
      <Button variant="outline" color="neutral" size="md" fullWidth disabled={disabled} icon={<BankLogo bank={id} />} onClick={onPick} dataTestId={`pix-bank-${id}`}>
        {/* The accessible name is "Abrir Nubank"; the eye reads the logo and "Nubank". */}
        <Box component="span" sx={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }}>
          {lead}
        </Box>
        {name.name}
      </Button>
    </Box>
  );
}

function Grid({ bank, state, stale }: { bank: CheckoutPixBank; state: PixBankState; stale: boolean }): JSX.Element {
  const { Text } = useCheckoutComponents();
  return (
    <Box data-testid="pix-bank-grid" sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <Text variant="body" size="md" weight="semibold" as="p" style={{ margin: 0 }}>
        {bank.copy.listTitle}
      </Text>
      <Box sx={{ containerType: "inline-size", containerName: "pixbanks" }}>
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 1 }}>
          {PIX_BANKS.map((id) => (
            <BankButton key={id} bank={bank} id={id} disabled={stale} onPick={() => state.open(id, true)} />
          ))}
        </Box>
      </Box>
    </Box>
  );
}

/** The one line under the bank being opened, where the checklist was (FUT-3612). */
function AppHint({ text }: { text: string }): JSX.Element {
  const { Text } = useCheckoutComponents();
  return (
    <Text variant="body" size="sm" color="secondary" as="p" style={{ margin: 0 }} data-testid="pix-bank-hint">
      {text}
    </Text>
  );
}

/** The grid, or the bank being opened and the line that says what to do there. */
export function PixBanks({ bank, state, stale }: { bank: CheckoutPixBank; state: PixBankState; stale: boolean }): JSX.Element {
  if (!state.chosen) return <Grid bank={bank} state={state} stale={stale} />;
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <Opening bank={bank} state={state} chosen={state.chosen} />
      {bank.copy.appHint ? <AppHint text={bank.copy.appHint} /> : null}
    </Box>
  );
}
