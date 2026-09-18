import { startDiscoveryBridge, BRIDGE_PORT, DEFAULT_TTL_MS, type BridgeHandle } from "./bridge";
import { scanForPrinters, type ScanOptions } from "./index";

/**
 * The helper a merchant downloads, as one function (FUT-2278).
 *
 * ## Why its own console output barely matters
 *
 * The merchant's real interface is the settings page in their browser: they
 * click "I don't know the IP", this answers, and the field fills. So this
 * prints almost nothing, in English, and carries no product copy — the package
 * boundary holds here exactly as it does for the transports.
 *
 * It does ONE thing beyond serving the bridge: it sweeps once at startup and
 * prints what it found. That is the fallback for the case where the browser
 * handshake fails for a reason nobody can diagnose from the shop floor — a
 * corporate policy, an extension, an unusual Chrome build. An address on screen
 * that somebody can retype is a worse experience and a complete one.
 *
 * ## It exits on its own
 *
 * A helper run once to set a printer up must not still be listening next
 * Tuesday. The TTL is the bridge's; this just reports it and resolves when the
 * server closes, so a packaged binary's process ends with it.
 */

export interface FinderOptions {
  /** Web origins allowed to call the bridge. Required — see below. */
  allowedOrigins: string[];
  port?: number;
  ttlMs?: number;
  /** Where status goes. Injected so a test does not write to the terminal. */
  log?: (line: string) => void;
  /**
   * Passed to both sweeps — the startup one and every one the bridge serves.
   *
   * The seam exists for tests, which must not sweep whatever network the CI
   * runner happens to sit on: that is slow, and its result is different on
   * every machine.
   */
  scanOptions?: ScanOptions;
}

/** Everything after `--origin`, plus whatever the environment supplies. */
export function parseOrigins(argv: string[], env: Record<string, string | undefined>): string[] {
  const origins: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--origin" && argv[index + 1] !== undefined) {
      origins.push(argv[index + 1] as string);
      index += 1;
    }
  }
  // A packaged, branded build bakes its own origin in here rather than asking a
  // merchant to type one; the flag stays for support and for development.
  const fromEnv = env.PRINTER_FINDER_ORIGINS;
  if (fromEnv !== undefined && fromEnv.length > 0) {
    for (const origin of fromEnv.split(",")) {
      const trimmed = origin.trim();
      if (trimmed.length > 0) origins.push(trimmed);
    }
  }
  return [...new Set(origins)];
}

/**
 * Start the helper.
 *
 * **Refuses to start with no allowed origin**, and that refusal is the security
 * boundary rather than a convenience check: a bridge that defaulted to allowing
 * anything would be a port scanner every website the merchant has open could
 * aim at the shop's network and read the results of. There is no safe default,
 * so there is no default.
 */
export async function runFinder(options: FinderOptions): Promise<BridgeHandle> {
  const log = options.log ?? ((line: string): void => console.log(line));
  if (options.allowedOrigins.length === 0) {
    throw new Error(
      "refusing to start with no allowed origin: pass --origin <url> or set PRINTER_FINDER_ORIGINS",
    );
  }

  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const bridge = await startDiscoveryBridge({
    allowedOrigins: options.allowedOrigins,
    ...(options.port === undefined ? {} : { port: options.port }),
    ...(options.scanOptions === undefined ? {} : { scanOptions: options.scanOptions }),
    ttlMs,
    onExpire: () => log("Finished. You can close this window."),
  });

  log(`Printer finder running on 127.0.0.1:${bridge.port}.`);
  log("Go back to your browser and press the button again.");
  log(`This closes on its own in ${Math.round(ttlMs / 60_000)} minutes.`);

  // The startup sweep. Its value is entirely in the failure case, so it must
  // never be what stops the bridge from serving: a throw here would take the
  // helper down over a diagnostic.
  try {
    const result = await scanForPrinters(options.scanOptions ?? {});
    if (result.printers.length === 0) {
      log("No printer answered yet. The browser button will search again.");
    } else {
      log("Printers found:");
      for (const printer of result.printers) {
        const grade = printer.confidence === "confirmed" ? "printer" : "maybe";
        log(`  ${printer.host}:${printer.port}  (${grade})`);
      }
    }
  } catch {
    log("Could not search the network from here. Use the browser button.");
  }

  return bridge;
}

/** The packaged binary's entry point. */
export async function main(
  argv: string[] = [],
  env: Record<string, string | undefined> = {},
): Promise<void> {
  const bridge = await runFinder({
    allowedOrigins: parseOrigins(argv, env),
    port: BRIDGE_PORT,
  });
  await new Promise<void>((resolve) => bridge.server.on("close", resolve));
}
