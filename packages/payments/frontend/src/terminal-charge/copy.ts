/**
 * Every word the terminal charge screens put in front of the operator.
 *
 * Required, with no defaults and no packs: which words a station uses for its
 * terminal, its sale and its counter is the host's vocabulary, so the host
 * passes them all (as `tender-split` takes its copy). Functions receive
 * amounts ALREADY formatted in the host's locale and currency, and tender
 * names already resolved from the host's catalogue.
 */

/** The wait for the leg on the terminal now, and its ways out. */
export interface TerminalWaitCopy {
  /** Where the leg is charged: the provider's name and the method's. */
  readonly where: (provider: string, method: string) => string;
  /** "Part 1 of 2". */
  readonly part: (part: number, parts: number) => string;
  /** What the terminal legs after this one still charge. */
  readonly after: (money: string) => string;
  readonly sending: string;
  readonly waiting: string;
  readonly waitingSub: string;
  readonly waitingPix: string;
  readonly waitingPixSub: string;
  readonly processing: string;
  readonly processingSub: string;
  readonly cancelling: string;
  readonly declined: string;
  readonly declinedSub: string;
  readonly cancelled: string;
  readonly cancelledSub: string;
  /** Released by the station without an end: paid or not is unknown. */
  readonly unknown: string;
  readonly unknownSub: string;
  /** The live leg while its terminal is off the network. */
  readonly away: string;
  readonly awaySub: string;
  /** Approved with no capture to bind. */
  readonly unbound: string;
  readonly unboundSub: string;
  /** Why the station did not push it, by its code (`NOT_CONNECTED`, `BUSY`…); `NOT_CONNECTED`'s words otherwise. */
  readonly refused: Readonly<Record<string, string>>;
  readonly refusedSub: string;
  /** The terminal still holds another charge: never "nothing was charged". */
  readonly busySub: string;
  /** The server refused the capture as disagreeing with the one it holds: it WAS charged, never "nothing was charged". */
  readonly conflict: string;
  readonly conflictSub: string;
  /** Moved to cash on the terminal. */
  readonly cash: (money: string) => string;
  readonly cashSub: string;
  /** Waiting for the station's first answer about its terminal. */
  readonly waitingLink: string;
  readonly waitingLinkSub: string;
  /** A done leg in the list beside the current one. */
  readonly doneLine: (label: string) => string;
  readonly resend: string;
  readonly other: string;
  readonly otherLabel: string;
  readonly cancel: string;
  /** State 6, shown only while the terminal cannot be used. */
  readonly otherMachine: string;
  readonly manualPix: string;
  /** A manual leg in the list, visibly marked as manual. */
  readonly manualLine: (label: string) => string;
  readonly cashReceived: (money: string) => string;
  /** Cancel the charge a reload left on the terminal. */
  readonly cancelPending: (money: string) => string;
  readonly settling: string;
}

/** State 6: a manual leg, recorded while the terminal cannot be used. */
export interface ElsewhereCopy {
  readonly otherMachineTitle: string;
  readonly manualPixTitle: string;
  /** Says the leg is recorded as manual, not as a terminal payment. */
  readonly manualNote: string;
  /** Names the method question (credit or debit). */
  readonly methodLabel: string;
  /** The optional reference field: the other machine's NSU or authorization. */
  readonly referenceLabel: string;
  readonly referenceHint: string;
  /** Said under a manual Pix when the store issues a fiscal note for it. */
  readonly fiscalNoteLine: string;
  readonly confirm: (money: string) => string;
  readonly back: string;
}

/** The reason and PIN that confirm a dangerous act. */
export interface ActConfirmCopy {
  readonly reasonLabel: string;
  readonly reasonHint: string;
  readonly reasonShort: string;
  readonly pinLabel: string;
  readonly pinMissing: string;
  readonly confirm: string;
  readonly back: string;
  /** The host's refusal, by its code; `fallback` for any other. */
  readonly refused: Readonly<Record<string, string>> & { readonly fallback: string };
}

/** The terminal approved a leg already received another way: the buyer paid twice. */
export interface ReceivedTwiceCopy {
  readonly title: (money: string) => string;
  readonly lede: string;
  /** Give the other payment (the cash) back, keeping the card. */
  readonly giveBack: (money: string) => string;
  /** Refund the card capture, keeping the other payment. */
  readonly refundCard: string;
  readonly done: string;
}

/** The captures passed the total (an edit lowered it). */
export interface OverCaptureCopy {
  readonly title: (money: string) => string;
  readonly lede: string;
  /** Hand the excess back in cash. */
  readonly change: (money: string) => string;
  /** Keep the excess as store credit for the buyer. */
  readonly credit: (money: string, buyer: string) => string;
  /** Refund the capture and charge the right total again. */
  readonly refundAndCharge: (refund: string, charge: string) => string;
}

/** Money the terminal took that no sale holds, offered on load. */
export interface RecoveredCopy {
  readonly title: string;
  /** Why these are offered (a reload in the middle of a charge). */
  readonly lede: string;
  /** One capture's label: its method's name and when. Its amount sits in a cell of its own. */
  readonly line: (method: string, at: string) => string;
  /** Under the list: what happens to a capture nobody uses (the refund window). */
  readonly footnote: string;
  /** The count shown on the station's indicator. */
  readonly count: (count: number) => string;
}
