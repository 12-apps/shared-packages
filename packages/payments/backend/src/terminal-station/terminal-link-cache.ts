import { decodeBase64, LINK_PROVIDERS, type LinkProvider } from "../terminal-link";

/**
 * The station's links to its paired terminals, as the host's server answers
 * them and as this computer keeps them.
 *
 * The server mints each link's secret at pairing, and the station reads its
 * links through the host's {@link TerminalLinkSource}. The LAN must keep
 * working with the server down, so the last good answer is kept in memory and
 * on disk, with each secret sealed by the operating system's key store
 * ({@link SecretSealer}). Where that store is not available, nothing secret is
 * written: the links live in memory only, until the next launch reads them
 * again.
 */

/** One link, as the source answers it. `secret` is the raw base64 the server minted. */
export interface TerminalLink {
  readonly deviceId: string;
  readonly provider: LinkProvider;
  /** The station's `host:port` the pairing recorded; null before one is. */
  readonly lanAddress: string | null;
  readonly secret: string;
}

/** Where the station's links come from: the host's server. */
export type TerminalLinkSource = () => Promise<readonly TerminalLink[]>;

/** A link as the station's settings keep it: the secret sealed, never in clear. */
export interface StoredTerminalLink {
  readonly deviceId: string;
  readonly provider: LinkProvider;
  readonly lanAddress: string | null;
  readonly sealedSecret: string;
}

/**
 * The operating system's key store, behind a port (an Electron host binds
 * `safeStorage`'s asynchronous methods).
 */
export interface SecretSealer {
  available(): Promise<boolean>;
  /** The secret sealed, as base64 text. */
  seal(plain: string): Promise<string>;
  /**
   * Rejects when the text was not sealed here. `reseal` is the key store
   * asking for the secret to be sealed again (its key was rotated).
   */
  open(sealed: string): Promise<{ readonly plain: string; readonly reseal: boolean }>;
}

const DEVICE_ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const LAN_ADDRESS = /^[A-Za-z0-9.-]{1,253}:\d{1,5}$/;
const SEALED = /^[A-Za-z0-9+/]+={0,2}$/;
/** At most one link per provider — and a few spare, for a merchant with more providers later. */
const MAX_LINKS = 8;

const isProvider = (value: unknown): value is LinkProvider => typeof value === "string" && (LINK_PROVIDERS as readonly string[]).includes(value);
const isDeviceId = (value: unknown): value is string => typeof value === "string" && DEVICE_ID.test(value);
const isLanAddress = (value: unknown): value is string | null => value === null || (typeof value === "string" && LAN_ADDRESS.test(value));
/** A secret long enough to key an HMAC: 16 bytes at least. */
const isSecret = (value: unknown): value is string => typeof value === "string" && value.length <= 512 && (decodeBase64(value)?.length ?? 0) >= 16;

/** The route's links, each read strictly; a malformed one is dropped, and only the first per device and per provider is kept. */
export function readTerminalLinks(input: unknown): TerminalLink[] {
  if (!Array.isArray(input)) return [];
  const out: TerminalLink[] = [];
  for (const entry of input.slice(0, MAX_LINKS * 4)) {
    const { deviceId, provider, lanAddress, secret } = (entry ?? {}) as Record<string, unknown>;
    if (!isDeviceId(deviceId) || !isProvider(provider) || !isLanAddress(lanAddress) || !isSecret(secret)) continue;
    if (out.some((link) => link.deviceId === deviceId || link.provider === provider)) continue;
    out.push({ deviceId, provider, lanAddress, secret });
  }
  return out.slice(0, MAX_LINKS);
}

/** The kept links as the station's settings hold them, read as strictly; anything else reads as none. */
export function parseStoredTerminalLinks(input: unknown): StoredTerminalLink[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, MAX_LINKS).flatMap((entry: unknown): StoredTerminalLink[] => {
    const { deviceId, provider, lanAddress, sealedSecret } = (entry ?? {}) as Record<string, unknown>;
    if (!isDeviceId(deviceId) || !isProvider(provider) || !isLanAddress(lanAddress)) return [];
    if (typeof sealedSecret !== "string" || sealedSecret.length > 4096 || !SEALED.test(sealedSecret)) return [];
    return [{ deviceId, provider, lanAddress, sealedSecret }];
  });
}

/** The links sealed for disk; `[]` when the key store is not available, so no secret is written in clear. */
export async function sealLinks(links: readonly TerminalLink[], sealer: SecretSealer): Promise<StoredTerminalLink[]> {
  if (!(await sealer.available())) return [];
  return Promise.all(links.map(async ({ secret, ...rest }) => ({ ...rest, sealedSecret: await sealer.seal(secret) })));
}

/**
 * The links kept on disk, opened; one that will not open here (another user,
 * another machine) is dropped. `onReseal` is called once when the key store
 * asked for any of them to be sealed again, so the caller writes them back.
 */
export async function openStoredLinks(
  stored: readonly StoredTerminalLink[],
  sealer: SecretSealer,
  onReseal?: () => void,
): Promise<TerminalLink[]> {
  if (!(await sealer.available())) return [];
  let reseal = false;
  const opened = await Promise.all(
    stored.map(async ({ sealedSecret, ...rest }): Promise<unknown[]> => {
      try {
        const open = await sealer.open(sealedSecret);
        reseal ||= open.reseal;
        return [{ ...rest, secret: open.plain }];
      } catch {
        return [];
      }
    }),
  );
  const links = readTerminalLinks(opened.flat());
  if (reseal && links.length > 0) onReseal?.();
  return links;
}
