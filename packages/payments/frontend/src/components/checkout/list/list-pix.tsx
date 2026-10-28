import { Box } from "@mui/material";
import { useEffect, useRef, useState, type JSX, type ReactNode } from "react";

import { usePaymentRefresh, usePaymentStale } from "../cart-changed";
import { useCheckoutCopy } from "../copy-context";
import { PixAfterCopy } from "../pix-after-copy";
import { PixCountdown, usePixCountdown, type PixCountdownCopy } from "../pix-countdown";
import type { PixAfterCopyCopy } from "../screens-copy";
import type { CheckoutOrder, PixCharge } from "../types";
import { useCheckoutComponents } from "../ui";

import { bankFlowOs, type PhoneOs } from "./bank-apps";
import type { PaymentListMode } from "./context";
import { ListBar, ActionButton } from "./list-bar";
import { BeforeCopy } from "./list-pix-before";
import { PixBanks, usePixBankState, type PixBankState } from "./pix-banks";
import type { CheckoutPixBank, PixBankId } from "./types";

/**
 * The Pix, in the one list (FUT-3592 #3): "Gerar Pix" already created the
 * order and the code, so the pane opens on the code itself.
 *
 * Over both faces, the countdown (FUT-1181, FUT-592): "expira em 12:34"
 * beside the title and a bar draining under it (`../pix-countdown`).
 *
 * Before the copy — the code in a tinted block that copies on a tap (the same
 * as the bar's "Copiar código Pix"), how to pay with it, and two text links:
 * the QR for paying from another device, and the way back to the list. On a
 * phone the QR opens under its link; on a computer it stands beside the code.
 * After the copy — ADR 0129's face (kept by the owner, 2026-10-28): the bar
 * holds "Copiar de novo", outlined; the card the steps and, on a phone, the
 * outlined "Mostrar QR code (para outro aparelho)"; a computer the QR beside
 * the steps. The code's face is `./list-pix-before.tsx`.
 */

/** The pane's title, with the countdown beside it while the expiry can be read. */
function PixHeading({ title, pix, copy, onLapse }: { title: string; pix: PixCharge; copy: PixCountdownCopy; onLapse?: () => void }): JSX.Element {
  const { Text } = useCheckoutComponents();
  const countdown = usePixCountdown(pix.expiresAt, onLapse);
  const heading = (
    <Text variant="body" size="md" weight="bold" as="p" style={{ margin: 0 }} data-testid="list-pix-title">
      {title}
    </Text>
  );
  if (!countdown) return heading;
  return <PixCountdown state={countdown} copy={copy} title={heading} storeConfirms={pix.confirmation === "MANUAL"} />;
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
  /** The countdown reached zero: ask the server now (FUT-1181). */
  onLapse?: () => void;
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

/** After the copy, the bar's control (ADR 0129, kept by the owner 2026-10-28): "Copiar de novo", outlined — the next step is in the bank app. */
interface CopyAgain {
  onClick: () => void;
  justCopied: boolean;
}

/** The bar's one control: held, "Atualizar pagamento", "Copiar de novo" after the copy, or the copy. */
function PixBarAction({ mode, afterCopy, onCopy, copyLabel, again }: {
  mode: PaymentListMode;
  afterCopy: boolean;
  onCopy: () => void;
  copyLabel: string;
  again: CopyAgain;
}): JSX.Element {
  const stale = usePaymentStale();
  const refresh = usePaymentRefresh();
  const screens = useCheckoutCopy().screens;
  const { hold } = mode.list;
  if (hold) return <ActionButton label={hold.action} total={null} disabled onClick={() => undefined} />;
  if (stale && refresh) return <ActionButton label={screens.cartChanged.refreshAction} total={null} disabled={false} onClick={refresh} />;
  if (afterCopy) {
    const label = again.justCopied ? screens.pix.copiedAction : screens.pix.copyAgainAction;
    return <ActionButton look="outline" testId="pix-copy-again" label={label} total={null} disabled={stale} onClick={again.onClick} />;
  }
  return <ActionButton label={copyLabel} total={null} disabled={stale} onClick={onCopy} />;
}

/**
 * The Pix's bar: the host's hold first (a step reopened above), then — over a
 * code the cart has outgrown — "Atualizar pagamento" (FUT-3535, E20), then
 * the copy before it and "Copiar de novo" after it, while the live region
 * says what it waits for.
 */
function ListPixBar({ mode, afterCopy, onCopy, bankFlow, onOtherBank, again }: {
  mode: PaymentListMode;
  afterCopy: boolean;
  onCopy: () => void;
  bankFlow: BankFlow | null;
  onOtherBank: () => void;
  again: CopyAgain;
}): JSX.Element {
  const copy = mode.list.copy.pixFace;
  const stale = usePaymentStale();
  const { hold } = mode.list;
  const settled = !hold && !stale;
  const other = settled && !afterCopy ? otherBankLabel(bankFlow) : null;
  return (
    <ListBar summary={mode.list.summary} reason={hold?.reason ?? null} actionLabel={hold?.action} live={afterCopy && settled ? copy.waiting : null}>
      <PixBarAction mode={mode} afterCopy={afterCopy} onCopy={onCopy} copyLabel={copyLabel(copy.copyCode, bankFlow)} again={again} />
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

/**
 * The way to the bank app on the after-copy face, or `undefined` off a phone.
 * With a bank chosen, one line says what to do there, in place of the
 * checklist (FUT-3612) — unless the STORE confirms this Pix: its checklist's
 * "A loja confirma o pagamento — até 14:32" is then the only place that says
 * who confirms and by when, so it stays — under the six banks too. No line in
 * the host's copy: the checklist stays too. Otherwise the six banks replace it.
 */
function bankFace(flow: BankFlow | null, pix: PixCharge, stale: boolean): { node: JSX.Element; replacesChecklist: boolean } | undefined {
  if (!flow?.os) return undefined;
  const storeConfirms = pix.confirmation === "MANUAL";
  const oneLine = Boolean(flow.bank.copy.appHint) && !storeConfirms;
  return {
    node: <PixBanks bank={flow.bank} state={flow.state} stale={stale} hint={oneLine} />,
    replacesChecklist: oneLine || (flow.state.chosen === null && !storeConfirms),
  };
}

/** Both faces of the list's Pix, and the bar under them. */
export function ListPixFace(props: ListPixFaceProps & { mode: PaymentListMode }): JSX.Element {
  const { mode, order, pix, afterCopy } = props;
  const copy = mode.list.copy.pixFace;
  const flow = useBankFlow(mode);
  const copies = useBankCopies(mode, flow, pix, props);
  const stale = usePaymentStale();
  // On a phone the bank flow takes the copy: "Copiar e abrir o Nubank", the
  // toast, the app. Without it — or on a computer — the copy is today's.
  const onCopy = flow ? copies.copy : props.onCopy;
  const again = { onClick: flow ? copies.copy : props.onCopyAgain, justCopied: props.justCopied };
  const banks = bankFace(flow, pix, stale);
  return (
    <Box data-testid="list-pix" sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      <PixHeading title={copy.title(mode.list.amountDueLabel ?? order.totalLabel)} pix={pix} copy={copy} onLapse={props.onLapse} />
      {afterCopy ? (
        <PixAfterCopy
          pix={pix}
          words={props.words}
          totalLabel={mode.list.amountDueLabel ?? order.totalLabel}
          deadline={props.time}
          justCopied={props.justCopied}
          onCopyAgain={again.onClick}
          onShowQr={() => {
            mode.setQrOpen(true);
            props.onShowQr();
          }}
          onPreferCard={props.onPreferCard}
          footer={props.footer}
          banks={banks}
          inList={{ qrLabel: copy.showQr }}
        />
      ) : (
        <BeforeCopy mode={mode} pix={pix} onCopy={onCopy} onChangeMethod={mode.onLeavePix} footer={props.footer} />
      )}
      <ListPixBar mode={mode} afterCopy={afterCopy} onCopy={onCopy} bankFlow={flow} onOtherBank={copies.other} again={again} />
    </Box>
  );
}
