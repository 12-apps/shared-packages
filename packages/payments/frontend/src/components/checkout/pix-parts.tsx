import { Box } from "@mui/material";
import { Fragment, useCallback, useEffect, useRef, useState, type JSX } from "react";
import QRCode from "react-qr-code";

/**
 * The pieces the PIX pane and its after-copy face share (the 2026-10-06 Pix
 * redesign): the container-query switch, the QR, bold spans in a sentence, and
 * the clipboard.
 */

/**
 * The pane switches from tabs to two columns by its OWN width, never the
 * window's: the same checkout is mounted in a 720px column, a 1040px one and a
 * phone, and only the room it was given says whether two columns fit.
 */
export const PIX_WIDE = "@container pixpane (min-width: 640px)";

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
