import { Box } from "@mui/material";
import type { JSX, ReactNode } from "react";

import { useCheckoutCopy } from "./copy-context";
import { ContentCopyIcon } from "./icons";
import { Emphasized, PIX_WIDE, PixQr } from "./pix-parts";
import type { PixCharge } from "./types";
import { useCheckoutComponents } from "./ui";

/**
 * The PIX pane before a copy (the 2026-10-06 Pix redesign).
 *
 * Narrow — a phone — it is two tabs, "Copia e cola" first: the buyer pays on
 * the phone they are holding and cannot scan a QR drawn on that same screen,
 * so the code and its full-width button come before anything else. Wide — a
 * desktop — the same two panels stand side by side with "ou" between them:
 * the QR, for the phone in the buyer's hand, and the code, for their internet
 * banking.
 *
 * Both panels are always mounted and the switch is CSS (`PIX_WIDE`), so the
 * layout needs no measurement: the first paint is already right, and the QR is
 * in the document whichever tab is showing.
 */

export type PixTab = "copy" | "qr";

/** A narrow-only element: shown under the container query's threshold. */
const NARROW_ONLY = { [PIX_WIDE]: { display: "none" } } as const;

/** A wide-only element. */
function wideOnly(display: string) {
  return { display: "none", [PIX_WIDE]: { display } } as const;
}

/** A tab panel: shown when its tab is picked, and always in the wide layout. */
function panelSx(shown: boolean) {
  return {
    display: shown ? "flex" : "none",
    flexDirection: "column",
    gap: 1.75,
    minWidth: 0,
    [PIX_WIDE]: { display: "flex" },
  } as const;
}

/** The small capitals over each wide column. Uppercase by CSS only. */
function ColumnHeading({ children, center }: { children: ReactNode; center?: boolean }): JSX.Element {
  const { Text } = useCheckoutComponents();
  return (
    <Box sx={{ ...wideOnly("block"), textAlign: center ? "center" : "left" }}>
      <Text variant="body" size="xs" weight="bold" color="secondary" as="p" style={{ textTransform: "uppercase", letterSpacing: "0.04em", margin: 0 }}>
        {children}
      </Text>
    </Box>
  );
}

function PixTabs({ tab, onTab }: { tab: PixTab; onTab: (tab: PixTab) => void }): JSX.Element {
  const copy = useCheckoutCopy().screens.pix;
  const tabs: { id: PixTab; label: string }[] = [
    { id: "copy", label: copy.copyPasteTab },
    { id: "qr", label: copy.qrTab },
  ];
  return (
    <Box
      role="tablist"
      aria-label={copy.tabsLabel}
      sx={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", borderBottom: "1px solid", borderColor: "divider", ...NARROW_ONLY }}
    >
      {tabs.map((item) => {
        const selected = item.id === tab;
        return (
          <Box
            key={item.id}
            component="button"
            type="button"
            role="tab"
            id={`pix-tab-${item.id}`}
            aria-selected={selected}
            aria-controls={`pix-panel-${item.id}`}
            data-testid={`pix-tab-${item.id}`}
            onClick={() => onTab(item.id)}
            sx={{
              minHeight: 44,
              border: 0,
              borderBottom: "3px solid",
              borderColor: selected ? "primary.main" : "transparent",
              bgcolor: "transparent",
              font: "inherit",
              fontSize: "0.875rem",
              fontWeight: selected ? 700 : 600,
              color: selected ? "text.primary" : "text.secondary",
              cursor: "pointer",
              "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: -2 },
            }}
          >
            {item.label}
          </Box>
        );
      })}
    </Box>
  );
}

function QrPanel({ pix, shown }: { pix: PixCharge; shown: boolean }): JSX.Element {
  const { Text } = useCheckoutComponents();
  const copy = useCheckoutCopy().screens.pix;
  return (
    <Box
      id="pix-panel-qr"
      role="tabpanel"
      aria-labelledby="pix-tab-qr"
      sx={{
        ...panelSx(shown),
        alignItems: "center",
        textAlign: "center",
        [PIX_WIDE]: { display: "flex", p: 3, borderRadius: 1.75, border: "1px solid", borderColor: "divider", bgcolor: "action.hover" },
      }}
    >
      <ColumnHeading center>{copy.qrHeading}</ColumnHeading>
      <Box sx={{ "& svg": { width: 200, height: 200 }, [PIX_WIDE]: { "& svg": { width: 232, height: 232 } } }}>
        <PixQr payload={pix.copyPaste} size={232} alt={copy.qrAlt} testId="pix-qr" />
      </Box>
      <Text variant="body" size="sm" color="secondary" as="p" style={{ margin: 0, maxWidth: 280 }}>
        <Box component="span" sx={NARROW_ONLY}>{copy.qrTabCaption}</Box>
        <Box component="span" sx={wideOnly("inline")}>
          <Emphasized text={copy.qrInstructions} />
        </Box>
      </Text>
    </Box>
  );
}

function CopyPanel({ pix, shown, onCopy }: { pix: PixCharge; shown: boolean; onCopy: () => void }): JSX.Element {
  const { Button, Text } = useCheckoutComponents();
  const copy = useCheckoutCopy().screens.pix;
  return (
    <Box id="pix-panel-copy" role="tabpanel" aria-labelledby="pix-tab-copy" sx={{ ...panelSx(shown), [PIX_WIDE]: { display: "flex", justifyContent: "center" } }}>
      <ColumnHeading>{copy.copyPasteHeading}</ColumnHeading>
      <Box
        sx={{ px: 2, py: 1.5, border: "1px solid", borderColor: "divider", borderRadius: 1.5, bgcolor: "action.hover" }}
      >
        <Text variant="code" size="xs" as="p" data-testid="pix-code" style={{ margin: 0, wordBreak: "break-all", lineHeight: 1.55 }}>
          {pix.copyPaste}
        </Text>
      </Box>
      {/* The one action on the pane: the prototype's 56px bar (52 wide), whatever the host's lg is. */}
      <Box sx={{ "& > *": { minHeight: 56 }, [PIX_WIDE]: { "& > *": { minHeight: 52 } } }}>
        <Button variant="solid" color="primary" size="lg" fullWidth icon={<ContentCopyIcon fontSize="small" />} onClick={onCopy} dataTestId="pix-copy">
          {copy.copyAction}
        </Button>
      </Box>
      <Text variant="body" size="sm" color="secondary" as="p" style={{ margin: 0 }}>
        <Box component="span" sx={{ display: "block", textAlign: "center", ...NARROW_ONLY }}>
          <Emphasized text={copy.copyPasteHint} />
        </Box>
        <Box component="span" sx={wideOnly("block")}>
          <Emphasized text={copy.internetBankingHint} />
        </Box>
      </Text>
    </Box>
  );
}

/** The word between the wide layout's two columns, on a hairline. */
function OrDivider(): JSX.Element {
  const { Text } = useCheckoutComponents();
  const copy = useCheckoutCopy().screens.pix;
  const line = { width: "1px", height: 56, bgcolor: "divider" };
  return (
    <Box aria-hidden sx={{ ...wideOnly("flex"), flexDirection: "column", alignItems: "center", alignSelf: "center", gap: 1 }}>
      <Box sx={line} />
      <Text variant="body" size="xs" weight="semibold" color="secondary" as="span">
        {copy.or}
      </Text>
      <Box sx={line} />
    </Box>
  );
}

export function PixPane({ pix, tab, onTab, onCopy }: { pix: PixCharge; tab: PixTab; onTab: (tab: PixTab) => void; onCopy: () => void }): JSX.Element {
  return (
    <>
      <PixTabs tab={tab} onTab={onTab} />
      <Box
        sx={{
          display: "grid",
          gap: 2,
          [PIX_WIDE]: { gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)", gap: 4, alignItems: "stretch" },
        }}
      >
        <QrPanel pix={pix} shown={tab === "qr"} />
        <OrDivider />
        <CopyPanel pix={pix} shown={tab === "copy"} onCopy={onCopy} />
      </Box>
    </>
  );
}
