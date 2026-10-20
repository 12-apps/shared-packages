import { Box, useTheme } from "@mui/material";
import { useEffect, useRef, useState, type JSX, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";

import { usePaymentRefresh, usePaymentStale } from "../cart-changed";
import { useCheckoutCopy } from "../copy-context";
import { PixAfterCopy } from "../pix-after-copy";
import { PixQr, StaleVeil } from "../pix-parts";
import type { PixAfterCopyCopy } from "../screens-copy";
import type { CheckoutOrder, PixCharge } from "../types";
import { useCheckoutComponents } from "../ui";

import { bankFlowOs, type PhoneOs } from "./bank-apps";
import type { PaymentListMode } from "./context";
import { ListBar, ActionButton, WaitingLine } from "./list-bar";
import { PixBanks, usePixBankState, type PixBankState } from "./pix-banks";
import type { CheckoutPixBank, PixBankId } from "./types";

/**
 * The Pix, in the one list (FUT-3592 #3): "Gerar Pix" already created the
 * order and the code, so the pane opens on the code itself.
 *
 * Before the copy — the code in a tinted block that copies on a tap (the same
 * as the bar's "Copiar código Pix"), "Válido até …", and two text links: the
 * QR for paying from another phone, and the way back to the list. On a
 * computer the QR stands beside the code instead. After the copy — ADR 0129's
 * face, as today, with the bar saying what it is waiting for.
 *
 * The side-by-side switch is a container query on the pane's own width, never
 * the window's (the 512px column a computer gives the checkout is still wider
 * than any phone's).
 */
const WIDE = "@container listpix (min-width: 460px)";

/** Select the code and copy it — a tap on it is the bar's button. */
function selectAll(target: HTMLElement): void {
  try {
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.selectAllChildren(target);
  } catch {
    // Selecting is a courtesy; the copy below is what matters.
  }
}

function TappableCode({ pix, label, onCopy }: { pix: PixCharge; label: string; onCopy: () => void }): JSX.Element {
  const stale = usePaymentStale();
  const { Text } = useCheckoutComponents();
  const press = (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) => {
    selectAll(event.currentTarget);
    onCopy();
  };
  // Under the veil the code is not a control at all — no role, no Tab stop,
  // nothing a tap does (ADR 0121: the veil covers it, so it may not be one).
  const control = stale
    ? {}
    : {
        role: "button",
        tabIndex: 0,
        "aria-label": label,
        onClick: press,
        onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            press(event);
          }
        },
      };
  return (
    <StaleVeil stale={stale}>
      <Box
        {...control}
        data-testid="list-pix-code"
        sx={{ cursor: stale ? "default" : "pointer", bgcolor: "action.hover", borderRadius: 2, p: 1.25, wordBreak: "break-all" }}
      >
        <Text variant="code" size="xs" as="span">
          {pix.copyPaste}
        </Text>
      </Box>
    </StaleVeil>
  );
}

function TextLink({ onClick, testId, children }: { onClick: () => void; testId: string; children: ReactNode }): JSX.Element {
  const { Button } = useCheckoutComponents();
  return (
    <Box sx={{ alignSelf: "flex-start", ml: -1, "& button": { textDecoration: "underline", textUnderlineOffset: (t) => t.spacing(0.375), minHeight: (t) => t.spacing(5) } }}>
      <Button variant="text" color="primary" size="md" onClick={onClick} dataTestId={testId}>
        {children}
      </Button>
    </Box>
  );
}

function BeforeCopy({ mode, pix, time, onCopy, onChangeMethod, footer }: {
  mode: PaymentListMode;
  pix: PixCharge;
  time: string;
  onCopy: () => void;
  onChangeMethod: () => void;
  footer: ReactNode;
}): JSX.Element {
  const { Text } = useCheckoutComponents();
  const copy = mode.list.copy.pixFace;
  const qrAlt = useCheckoutCopy().screens.pix.qrAlt;
  // The prototype's 150px QR, on the theme's spacing scale (the QR draws in px).
  const qrSize = Number.parseFloat(useTheme().spacing(18.75));
  const stale = usePaymentStale();
  return (
    <Box sx={{ containerType: "inline-size", containerName: "listpix" }}>
      <Box sx={{ display: "flex", gap: 2, alignItems: "flex-start", flexDirection: "column", [WIDE]: { flexDirection: "row" } }}>
        <Box data-testid="list-pix-qr" sx={{ display: mode.qrOpen ? "block" : "none", alignSelf: "center", flex: "none", [WIDE]: { display: "block", alignSelf: "flex-start" } }}>
          <StaleVeil stale={stale}>
            <PixQr payload={pix.copyPaste} size={qrSize} alt={qrAlt} />
          </StaleVeil>
        </Box>
        <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
          <TappableCode pix={pix} label={copy.copyCode} onCopy={onCopy} />
          <Text variant="body" size="sm" color="secondary" as="p" style={{ margin: 0 }} data-testid="list-pix-valid">
            {copy.validUntil(time)}
          </Text>
          <Box sx={{ [WIDE]: { display: "none" } }}>
            <TextLink onClick={() => mode.setQrOpen(!mode.qrOpen)} testId="list-pix-toggle-qr">
              {mode.qrOpen ? copy.hideQr : copy.showQr}
            </TextLink>
          </Box>
          <TextLink onClick={onChangeMethod} testId="list-pix-change-method">
            {copy.changeMethod}
          </TextLink>
          {footer}
        </Box>
      </Box>
    </Box>
  );
}

interface ListPixFaceProps {
  order: CheckoutOrder;
  pix: PixCharge;
  /** The code's expiry, in the host's locale. */
  time: string;
  afterCopy: boolean;
  words: PixAfterCopyCopy;
  justCopied: boolean;
  /** Copy, then show the after-copy face. */
  onCopy: () => void;
  onCopyAgain: () => void;
  /** Back from the after-copy face to the code, QR open. */
  onShowQr: () => void;
  onPreferCard?: () => void;
  /** The poll's stalled panel, when it has one. */
  footer: ReactNode;
  /** The clipboard alone, saying whether it took the code — the bank flow's copy. */
  writeClipboard: () => Promise<boolean>;
  setAfterCopy: (afterCopy: boolean) => void;
}

/** A phone with a bank remembered: the copy opens it too, and keeps the way to another (FUT-3612). */
function rememberedOnPhone(flow: BankFlow | null): PixBankId | null {
  return flow?.os ? flow.state.chosen : null;
}

/** "Copiar e abrir no Nubank" with a remembered bank on a phone, else the plain copy. */
function copyLabel(plain: string, flow: BankFlow | null): string {
  const remembered = rememberedOnPhone(flow);
  return remembered && flow ? flow.bank.copy.copyAndOpen(flow.bank.copy.names[remembered]) : plain;
}

/** "Abrir outro banco", when a remembered bank on a phone is what the copy opens. */
function otherBankLabel(flow: BankFlow | null): string | null {
  return flow && rememberedOnPhone(flow) ? flow.bank.copy.openOther : null;
}

/** The bar's one control: held, "Atualizar pagamento", the wait after the copy, or the copy. */
function PixBarAction({ mode, afterCopy, onCopy, copyLabel }: {
  mode: PaymentListMode;
  afterCopy: boolean;
  onCopy: () => void;
  copyLabel: string;
}): JSX.Element {
  const stale = usePaymentStale();
  const refresh = usePaymentRefresh();
  const refreshLabel = useCheckoutCopy().screens.cartChanged.refreshAction;
  const { hold } = mode.list;
  if (hold) return <ActionButton label={hold.action} total={null} disabled onClick={() => undefined} />;
  if (stale && refresh) return <ActionButton label={refreshLabel} total={null} disabled={false} onClick={refresh} />;
  if (afterCopy) return <WaitingLine text={mode.list.copy.pixFace.waiting} />;
  return <ActionButton label={copyLabel} total={null} disabled={stale} onClick={onCopy} />;
}

/**
 * The Pix's bar: the host's hold first (a step reopened above), then — over a
 * code the cart has outgrown — "Atualizar pagamento" (FUT-3535, E20), then
 * the copy before it and the wait after it.
 */
function ListPixBar({ mode, afterCopy, onCopy, bankFlow, onOtherBank }: {
  mode: PaymentListMode;
  afterCopy: boolean;
  onCopy: () => void;
  bankFlow: BankFlow | null;
  onOtherBank: () => void;
}): JSX.Element {
  const copy = mode.list.copy.pixFace;
  const stale = usePaymentStale();
  const { hold } = mode.list;
  const settled = !hold && !stale;
  const other = settled && !afterCopy ? otherBankLabel(bankFlow) : null;
  return (
    <ListBar summary={mode.list.summary} reason={hold?.reason ?? null} live={afterCopy && settled ? copy.waiting : null}>
      <PixBarAction mode={mode} afterCopy={afterCopy} onCopy={onCopy} copyLabel={copyLabel(copy.copyCode, bankFlow)} />
      {other ? <OtherBankLink label={other} onClick={onOtherBank} /> : null}
    </ListBar>
  );
}

/** "Abrir outro banco" — a centred text link under the bar's button (FUT-3612). */
export function OtherBankLink({ label, onClick }: { label: string; onClick: () => void }): JSX.Element {
  const { Button } = useCheckoutComponents();
  return (
    <Box sx={{ display: "flex", justifyContent: "center", "& button": { textDecoration: "underline", minHeight: (t) => t.spacing(5.5) } }}>
      <Button variant="text" color="primary" size="sm" onClick={onClick} dataTestId="pix-open-other-bank">
        {label}
      </Button>
    </Box>
  );
}

/** The Pix-to-bank flow, when the host offers it (FUT-3612). */
interface BankFlow {
  bank: CheckoutPixBank;
  /** `null` on a computer: copy-and-say, no banks. */
  os: PhoneOs | null;
  state: PixBankState;
}

/** The toast after a copy: which bank opens, or that one is to be chosen. */
function copiedSentence(flow: BankFlow, opening: PixBankId | null): string {
  const { copy } = flow.bank;
  if (!flow.os) return copy.copied;
  return opening ? copy.copiedOpening(copy.names[opening]) : copy.copiedPick;
}

/** A copy the clipboard took: the after-copy face, the grid when asked for, the toast, and the bank opened. */
function landCopy(at: { mode: PaymentListMode; flow: BankFlow; ports: CopyPorts; stale: boolean }, opening: PixBankId | null, grid: boolean): void {
  const { mode, flow, ports } = at;
  ports.setAfterCopy(true);
  if (grid) flow.state.showGrid();
  const target = flow.os ? opening : null;
  mode.list.notify?.(copiedSentence(flow, target));
  if (target && !at.stale) flow.state.open(target, false);
}

/**
 * Every copy on the bank flow ends the same way: the after-copy face, the
 * toast, and the bank opened — the one chosen, or none when the grid is asked
 * for. A copy the clipboard refused does none of it (the code stays to copy by
 * hand).
 */
function useBankCopies(mode: PaymentListMode, flow: BankFlow | null, pix: PixCharge, ports: CopyPorts) {
  const stale = usePaymentStale();
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const land = (ok: boolean, grid: boolean, target: PixBankId | null): void => {
    if (ok && live.current && flow) landCopy({ mode, flow, ports, stale }, grid ? null : target, grid);
  };
  // The bar's press already opened the clipboard, waiting for this code.
  useEffect(() => {
    const intent = mode.pixIntent.current;
    if (!intent) return;
    mode.pixIntent.current = null;
    intent.copy.resolve(pix.copyPaste);
    void intent.copy.done.then((ok) => land(ok, intent.pick, intent.pick ? null : intent.bank));
    // Once, as the code arrives.
  }, []);
  const copyThen = (grid: boolean) => () =>
    void ports.writeClipboard().then((ok) => land(ok, grid, flow?.state.chosen ?? null));
  return { copy: copyThen(false), other: copyThen(true) };
}

interface CopyPorts {
  writeClipboard: () => Promise<boolean>;
  setAfterCopy: (afterCopy: boolean) => void;
}

/** The bank flow's state, or `null` when the host does not offer it. */
function useBankFlow(mode: PaymentListMode): BankFlow | null {
  const bank = mode.list.pixBank;
  const [os] = useState(() => bankFlowOs(bank?.phone));
  const stale = usePaymentStale();
  const startOnGrid = mode.pixIntent.current?.pick ?? false;
  const state = usePixBankState(bank?.remembered ?? null, bank?.onPick ?? noPick, os, stale, startOnGrid);
  return bank ? { bank, os, state } : null;
}

function noPick(): void {
  // No bank flow: nothing to remember.
}

/** Both faces of the list's Pix, and the bar under them. */
export function ListPixFace(props: ListPixFaceProps & { mode: PaymentListMode }): JSX.Element {
  const { Text } = useCheckoutComponents();
  const { mode, order, pix, afterCopy } = props;
  const copy = mode.list.copy.pixFace;
  const flow = useBankFlow(mode);
  const copies = useBankCopies(mode, flow, pix, props);
  const stale = usePaymentStale();
  // On a phone the bank flow takes the copy: "Copiar e abrir o Nubank", the
  // toast, the app. Without it — or on a computer — the copy is today's.
  const onCopy = flow ? copies.copy : props.onCopy;
  const banks = flow?.os ? { node: <PixBanks bank={flow.bank} state={flow.state} stale={stale} />, replacesChecklist: true } : undefined;
  return (
    <Box data-testid="list-pix" sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      <Text variant="body" size="md" weight="bold" as="p" style={{ margin: 0 }} data-testid="list-pix-title">
        {copy.title(mode.list.amountDueLabel ?? order.totalLabel)}
      </Text>
      {afterCopy ? (
        <PixAfterCopy
          pix={pix}
          words={props.words}
          totalLabel={mode.list.amountDueLabel ?? order.totalLabel}
          deadline={props.time}
          justCopied={props.justCopied}
          onCopyAgain={flow ? copies.copy : props.onCopyAgain}
          onShowQr={() => {
            mode.setQrOpen(true);
            props.onShowQr();
          }}
          onPreferCard={props.onPreferCard}
          footer={props.footer}
          banks={banks}
        />
      ) : (
        <BeforeCopy mode={mode} pix={pix} time={props.time} onCopy={onCopy} onChangeMethod={mode.onLeavePix} footer={props.footer} />
      )}
      <ListPixBar mode={mode} afterCopy={afterCopy} onCopy={onCopy} bankFlow={flow} onOtherBank={copies.other} />
    </Box>
  );
}
