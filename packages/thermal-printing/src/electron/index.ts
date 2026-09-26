import { BrowserWindow, type Session } from "electron";

/**
 * `@12-apps/thermal-printing/electron` — putting an HTML ticket on a printer
 * attached to THIS machine, with no dialog.
 *
 * A browser prints through `window.print()`, which raises a dialog somebody
 * has to dismiss for every ticket (or a `--kiosk-printing` flag on a browser
 * the machine also uses for everything else), and prints to whichever printer
 * the browser defaults to. An Electron main process prints with
 * `silent: true` and a named device: no flag, no dialog, and the machine
 * chooses WHICH printer.
 *
 * The document is typically `./html`'s output — sized in `ch`,
 * `@page { margin: 0 }` — and printing one means rendering it, in an
 * offscreen window created, loaded, printed and destroyed per ticket. A reused
 * window would carry the previous ticket's layout state into the next, and
 * the failure would be a wrong ticket rather than no ticket.
 *
 * `electron` is an optional peer: only this subpath imports it.
 */

/**
 * The operating system refused the print job.
 *
 * `success: false` is the case worth insisting on: Electron's callback runs,
 * nothing throws, and a caller that ignored it would record the ticket as
 * printed. `reason` is Electron's `failureReason` as given — `null` when it
 * gave none — and the message is that reason or the code `print_refused`,
 * never a sentence: what a person reads is the host's copy.
 */
export class PrintRefusedError extends Error {
  readonly reason: string | null;

  constructor(reason: string | null) {
    super(reason ?? "print_refused");
    this.name = "PrintRefusedError";
    this.reason = reason;
  }
}

export interface PrintHtmlOptions {
  /** A whole HTML document. */
  html: string;
  /** The OS device name; `null` is the system default printer. */
  deviceName: string | null;
  /**
   * The session (partition) to render in. Omitted: Electron's default. A
   * ticket loaded as a `data:` URL with scripts off needs no cookies, but a
   * host may keep every window it opens in its own partition.
   */
  session?: Session;
}

/**
 * Render one HTML document offscreen and print it silently.
 *
 * Rejects with {@link PrintRefusedError} when the operating system says no.
 * A document that fails to LOAD rejects with Electron's own error, untouched.
 */
export async function printHtml(options: PrintHtmlOptions): Promise<void> {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      ...(options.session === undefined ? {} : { session: options.session }),
      offscreen: true,
      nodeIntegration: false,
      contextIsolation: true,
      // A ticket is markup the host rendered, but it may carry other people's
      // text; nothing about printing it needs a network or a script.
      javascript: false,
    },
  });
  try {
    // A data URL rather than a temp file: a receipt is a few kilobytes, and a
    // file would have to be cleaned up on a path that can throw between
    // writing and deleting it.
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(options.html)}`);
    await printWindow(window, options.deviceName);
  } finally {
    // `destroy`, not `close`: an offscreen window has nobody to answer a
    // close, and a leaked one holds a renderer process for the life of the
    // process — which, for a background agent, is measured in weeks.
    if (!window.isDestroyed()) window.destroy();
  }
}

/** Print one loaded window, and reject when the operating system says no. */
function printWindow(window: BrowserWindow, deviceName: string | null): Promise<void> {
  return new Promise((resolve, reject) => {
    window.webContents.print(
      {
        silent: true,
        printBackground: true,
        margins: { marginType: "none" },
        ...(deviceName === null ? {} : { deviceName }),
      },
      (success, failureReason) => {
        if (success) resolve();
        else reject(new PrintRefusedError(failureReason || null));
      },
    );
  });
}
