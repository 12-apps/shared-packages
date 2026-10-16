/**
 * Opening the buyer's bank app from the Pix face (FUT-3612).
 *
 * There is no standard Pix link that pays a copia-e-cola code, so this only
 * OPENS the app; the buyer pastes the code the button already copied. Android
 * opens an app through an `intent:` URL naming its package; iOS only through a
 * URL scheme the bank's app registers. Neither tells the page whether it
 * worked, so {@link openBankApp} watches the page: an app that opened takes
 * the screen within a moment, and a page still visible after
 * {@link OPEN_WAIT_MS} is a bank that did not open — not installed, or a link
 * this phone does not know.
 */
import type { PixBankId } from "./types";

/** How long a page may stay visible before the bank counts as not opened. */
export const OPEN_WAIT_MS = 1500;

interface BankApp {
  /** The Play Store package of the bank's personal app — each one checked on its Play listing (2026-10-16). */
  android: string;
  /**
   * The URL scheme its app answers on iOS (without "://"). Only Nubank's
   * (`nuapp`) is documented — in Nubank's own deep links. The other five
   * publish no scheme we could find: theirs are the likeliest name, and a
   * phone that does not know one is a bank that "did not open", which the face
   * says (owner, 2026-10-16: Android and iOS, and say so when it does not open).
   */
  ios: string;
  /** A scheme Android opens the app with, when one is known; else the app's launcher, by package. */
  scheme?: string;
}

/** The six, in the prototype's order. */
export const PIX_BANKS: readonly PixBankId[] = ["nubank", "itau", "bradesco", "bb", "caixa", "santander"];

const APPS: Record<PixBankId, BankApp> = {
  nubank: { android: "com.nu.production", ios: "nuapp", scheme: "nuapp" },
  itau: { android: "com.itau", ios: "itau" },
  bradesco: { android: "com.bradesco", ios: "bradesco" },
  bb: { android: "br.com.bb.android", ios: "bbapp" },
  caixa: { android: "br.gov.caixa.CAIXA", ios: "caixa" },
  santander: { android: "com.santander.app", ios: "santanderpf" },
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
 * The URL that opens `bank`'s app on `os`. Android: an `intent:` URL naming the
 * package — through the app's scheme when one is known, else its launcher; a
 * phone without the app gets the bank's Play Store page from the browser.
 */
export function bankAppUrl(bank: PixBankId, os: PhoneOs): string {
  const app = APPS[bank];
  if (os === "ios") return `${app.ios}://`;
  if (app.scheme) return `intent://#Intent;scheme=${app.scheme};package=${app.android};end`;
  return `intent:#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package=${app.android};end`;
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
      // A scheme the browser refuses outright is a bank that did not open.
    }
  });
}
