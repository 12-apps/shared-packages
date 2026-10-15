import { Box } from "@mui/material";
import { Fragment, useCallback, useEffect, useRef, useState, type JSX, type ReactNode } from "react";
import QRCode from "react-qr-code";

import { useCheckoutCopy } from "./copy-context";

/**
 * The pieces the PIX pane and its after-copy face share (the 2026-10-06 Pix
 * redesign): the container-query switch, the QR, bold spans in a sentence, and
 * the clipboard.
 */

/**
 * The pane switches from one column to two by its OWN width, never the
 * window's: the same checkout is mounted beside an order summary, alone in a
 * column and on a phone, and only the room it was given says whether two
 * columns fit. 680px is what the Pagamento step's payment column leaves it
 * beside the summary card (FUT-3525).
 */
export const PIX_WIDE = "@container pixpane (min-width: 680px)";

/** The container the {@link PIX_WIDE} query reads. */
export const PIX_CONTAINER = { containerType: "inline-size", containerName: "pixpane" } as const;

/**
 * A sentence with `**…**` spans drawn bold. The copy packs mark the words the
 * buyer looks for in their bank app ("Pix Copia e Cola"), so the emphasis is
 * chosen with the words, by whoever writes them.
 */
export function Emphasized({ text }: { text: string }): JSX.Element {
  const parts = text.split("**");
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? <b key={index}>{part}</b> : <Fragment key={index}>{part}</Fragment>,
      )}
    </>
  );
}

/** The QR, in its bordered box, at `size` px. */
export function PixQr({ payload, size, alt, testId }: { payload: string; size: number; alt: string; testId?: string }): JSX.Element {
  return (
    <Box
      data-testid={testId}
      role="img"
      aria-label={alt}
      sx={{ bgcolor: "background.paper", p: 1.75, borderRadius: 1.5, border: "1px solid", borderColor: "divider", lineHeight: 0 }}
    >
      <QRCode value={payload} size={size} />
    </Box>
  );
}

/**
 * Copy the payload, and say so for two seconds. `copy` resolves `true` only
 * when the clipboard took it: a failed write must not move the buyer on to a
 * screen that says "Código Pix copiado" (the code stays visible to select by
 * hand instead).
 */
export function useClipboardCopy(text: string): { copy: () => Promise<boolean>; justCopied: boolean } {
  const [justCopied, setJustCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const copy = useCallback(async (): Promise<boolean> => {
    try {
      if (!navigator.clipboard) return false;
      await navigator.clipboard.writeText(text);
    } catch {
      return false;
    }
    setJustCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setJustCopied(false), 2000);
    return true;
  }, [text]);
  return { copy, justCopied };
}

/**
 * A PIX's QR or code, veiled while the cart has changed under it (FUT-3535):
 * blurred past reading, out of reach of a pointer, a selection and a screen
 * reader, with "Atualize para gerar um novo Pix" over it. The step's warning
 * above says why and carries the control that brings a new code. One tree
 * shape either way, so lifting the veil redraws nothing.
 */
export function StaleVeil({ stale, children }: { stale: boolean; children: ReactNode }): JSX.Element {
  const words = useCheckoutCopy().screens.cartChanged.pixVeil;
  return (
    <Box sx={{ position: "relative", minWidth: 0 }} data-testid={stale ? "pix-stale-veil" : undefined}>
      <Box
        aria-hidden={stale || undefined}
        sx={stale ? { filter: "blur(6px)", opacity: 0.5, pointerEvents: "none", userSelect: "none" } : undefined}
      >
        {children}
      </Box>
      {stale ? (
        <Box
          sx={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", p: 1.5 }}
        >
          <Box
            component="p"
            // An opaque overlay over the blurred code (ADR 0121): it covers
            // what is under it on purpose, so the review probe reads it so.
            data-ui-overlay=""
            sx={{
              m: 0,
              px: 1.5,
              py: 0.75,
              borderRadius: 999,
              bgcolor: "background.paper",
              boxShadow: 1,
              color: "text.primary",
              fontSize: "0.8125rem",
              fontWeight: 600,
              textAlign: "center",
            }}
          >
            {words}
          </Box>
        </Box>
      ) : null}
    </Box>
  );
}
