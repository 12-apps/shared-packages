/**
 * Load a provider SDK on first use. The SDKs are OPTIONAL peers: a host that
 * only talks to one provider installs one SDK, and an adapter whose SDK is
 * missing fails with a typed error naming the package to install.
 */
import { UnsupportedError } from "../errors";

export async function loadSdk<T>(provider: string, packageName: string, load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") {
      throw new UnsupportedError(provider, `The "${provider}" adapter needs the optional peer "${packageName}"; install it, or pass a client.`);
    }
    throw error;
  }
}
