/**
 * Opening the buyer's bank app from the Pix face (FUT-3612).
 *
 * There is no standard Pix link that pays a copia-e-cola code, so this only
 * OPENS the app; the buyer pastes the code the button already copied. Both
 * phones go to the bank's page in their store, whose "Abrir" opens the
 * installed app (FUT-4081: see {@link bankAppUrl}). Neither tells the page whether it
 * worked, so {@link openBankApp} watches the page: an app that opened takes
 * the screen within a moment, and a page still visible after
 * {@link OPEN_WAIT_MS} is a bank that did not open — not installed, or a link
 * this phone does not know.
 */
import type { PixBankId } from "./types";

/** How long a page may stay visible before the bank counts as not opened. */
const OPEN_WAIT_MS = 1500;

interface BankApp {
  /** The Play Store package of the bank's personal app — each one checked on its Play listing (2026-10-28). */
  android: string;
  /**
   * The id of the bank's personal app on the Brazilian App Store, each one read
   * from the App Store's own lookup, its bundle id the one the bank's site
   * declares (2026-10-28).
   */
  appStoreId: string;
}

/** The six, in the prototype's order. */
export const PIX_BANKS: readonly PixBankId[] = ["nubank", "itau", "bradesco", "bb", "caixa", "santander"];

const APPS: Record<PixBankId, BankApp> = {
  nubank: { android: "com.nu.production", appStoreId: "814456780" },
  itau: { android: "com.itau", appStoreId: "474505665" },
  bradesco: { android: "com.bradesco", appStoreId: "336954985" },
  bb: { android: "br.com.bb.android", appStoreId: "330984271" },
  caixa: { android: "br.com.gabba.Caixa", appStoreId: "490813624" },
  santander: { android: "com.santander.app", appStoreId: "613365711" },
};

export type PhoneOs = "android" | "ios";

/** The phone this page runs on, or `null` for a computer (or no browser at all). */
export function phoneOs(nav: Pick<Navigator, "userAgent" | "maxTouchPoints"> | undefined = typeof navigator === "undefined" ? undefined : navigator): PhoneOs | null {
  if (!nav) return null;
  const ua = nav.userAgent;
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  // iPadOS asks for the desktop site: a "Macintosh" with a touch screen.
  if (/Macintosh/i.test(ua) && nav.maxTouchPoints > 1) return "ios";
  return null;
}

/**
 * The phone the host's bank flow runs on: its own word when it gave one
 * (`phone`), else the browser's. `null` ⇒ a computer: no banks.
 */
export function bankFlowOs(phone: boolean | undefined): PhoneOs | null {
  if (phone === false) return null;
  if (phone === true) return phoneOs() ?? "android";
  return phoneOs();
}

/**
 * The URL that opens `bank`'s app on `os`: the bank's page in the phone's
 * store, whose "Abrir" opens the installed app (and whose install button gets
 * a missing one) — one tap more, but it always lands (FUT-4081).
 *
 * Opening the app directly did not. On iOS a guessed URL scheme made Safari
 * say the address was invalid (`nuapp://` is not one Nubank's iPhone app
 * answers), and Nubank's universal links name a task each (`/payment/…`,
 * `/sim/…`): tapped with nothing to do, the app opened and sent the buyer
 * straight to the browser (owner's iPhone tests). On Android Chrome launches an
 * `intent:` only into an activity that declares itself BROWSABLE for it, so the
 * scheme and launcher intents fell back to the Play Store page anyway — and
 * Caixa's package was wrong, so its page did not exist.
 */
export function bankAppUrl(bank: PixBankId, os: PhoneOs): string {
  const app = APPS[bank];
  if (os === "ios") return `https://apps.apple.com/br/app/id${app.appStoreId}`;
  return `https://play.google.com/store/apps/details?id=${app.android}`;
}

/**
 * Open `bank`'s app, and say whether it opened: `true` when the page lost the
 * screen (hidden, or left) within {@link OPEN_WAIT_MS}.
 */
export function openBankApp(
  bank: PixBankId,
  os: PhoneOs,
  env: { win: Window; doc: Document; waitMs?: number } = { win: window, doc: document },
): Promise<boolean> {
  const { win, doc } = env;
  return new Promise((resolve) => {
    let left = false;
    const onVisibility = (): void => {
      if (doc.visibilityState === "hidden") left = true;
    };
    const onLeave = (): void => {
      left = true;
    };
    doc.addEventListener("visibilitychange", onVisibility);
    win.addEventListener("pagehide", onLeave);
    win.addEventListener("blur", onLeave);
    win.setTimeout(() => {
      doc.removeEventListener("visibilitychange", onVisibility);
      win.removeEventListener("pagehide", onLeave);
      win.removeEventListener("blur", onLeave);
      resolve(left);
    }, env.waitMs ?? OPEN_WAIT_MS);
    try {
      win.location.href = bankAppUrl(bank, os);
    } catch {
      // A navigation the browser refuses outright is a bank that did not open.
    }
  });
}
